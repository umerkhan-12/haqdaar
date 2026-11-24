import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import {
  CurrentPrincipal,
  CurrentUser,
  InternalOnly,
  PartnerScope,
  requirePlatformAdmin,
  Roles,
  ServiceClient,
  ZBody,
  type AuthUser,
  type Principal,
} from '@haqdaar/nest-kit';
import { ScamCheckRequest } from '@haqdaar/shared';
import { z } from 'zod';
import { AiService } from './ai.service';
import { ExplainRequest } from './tasks/explain';

const ProfileBody = z.object({ profile: z.enum(['dev', 'demo', 'offline']) });
const KillBody = z.object({ killed: z.boolean() });
/** One or two sentences at a time: long text is the caller's job to split, so every piece caches well. */
const SpeakBody = z.object({
  text: z.string().trim().min(1).max(600),
  lang: z.enum(['ur', 'en']).default('ur'),
});
/** A spoken or typed question; `lang` is the language of the screen, so the answer comes back in it. */
const AssistBody = z
  .object({
    question: z.string().trim().min(2).max(1500),
    lang: z.enum(['ur', 'en']).default('ur'),
  })
  .strict();
/** District is optional and only used to place the check on the Scam Map; it is never tied to a person. */
const District = z.string().trim().min(1).max(40).optional();
const ScamCheckBody = ScamCheckRequest.extend({ district: District });
const ScamReportBody = z
  .object({
    text: z.string().trim().min(1).max(2000),
    verdict: z.enum(['GENUINE', 'SCAM', 'UNSURE']),
    redFlags: z.array(z.string().max(40)).max(12).default([]),
    district: District,
  })
  .strict();
const ExtractBody = z.object({ transcript: z.string().min(1).max(4000) });
const EmbedBody = z.object({
  text: z.string().min(1).max(4000),
  taskType: z.enum(['RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT']).optional(),
});
const AnswerSourcesBody = z.object({
  question: z.string().min(1).max(1200),
  sources: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        docId: z.string().min(1).max(120),
        heading: z.string().min(1).max(200),
        content: z.string().min(1).max(6000),
      }),
    )
    .min(1)
    .max(4),
});

const TypedCnic = z
  .string()
  .regex(/^\d{5}-?\d{7}-?\d$/)
  .transform((c) => c.replace(/-/g, '').replace(/^(\d{5})(\d{7})(\d)$/, '$1-$2-$3'));

/** Upload body; over the multipart limit → 413 (multipart throws, which would otherwise be a 500). */
const readLimited = (file: MultipartFile, what: string) =>
  file.toBuffer().catch((err: { code?: string }) => {
    if (err.code === 'FST_REQ_FILE_TOO_LARGE')
      throw new PayloadTooLargeException(`${what} too large (max 5 MB)`);
    throw err;
  });

const AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
];

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly client: ServiceClient,
  ) {}

  /** Active profile, provider chain with circuit states, stats. */
  @Roles('admin', 'auditor', 'officer')
  @Get('status')
  status() {
    return this.ai.status();
  }

  /** Switch AI profile at runtime (e.g. to `demo` on judging day). One profile serves every program: platform admins only. Logged. */
  @Roles('admin')
  @Post('profile')
  @HttpCode(200)
  async setProfile(
    @CurrentPrincipal() p: Principal,
    @ZBody(ProfileBody) b: z.infer<typeof ProfileBody>,
  ) {
    await requirePlatformAdmin(this.client, p, 'The AI profile');
    return this.ai.setProfile(b.profile, p);
  }

  /** Kill AI: every AI answer becomes "not sure"; the system keeps working through humans. Every program at once: platform admins only. */
  @Roles('admin')
  @Post('kill-switch')
  @HttpCode(200)
  async kill(@CurrentPrincipal() p: Principal, @ZBody(KillBody) b: z.infer<typeof KillBody>) {
    await requirePlatformAdmin(this.client, p, 'Kill AI');
    return this.ai.setKilled(b.killed, p);
  }

  @Roles('citizen', 'helper', 'officer')
  @Post('extract-claim')
  @HttpCode(200)
  extract(@ZBody(ExtractBody) b: z.infer<typeof ExtractBody>) {
    return this.ai.extractClaim(b.transcript);
  }

  /**
   * Decision → one or two warm sentences she can understand by ear. Guardrails: no number that the
   * engine did not give, no wording that contradicts the lane; otherwise the engine's template comes back.
   */
  @Roles('citizen', 'helper', 'officer')
  @Post('explain')
  @HttpCode(200)
  explain(@ZBody(ExplainRequest) b: z.infer<typeof ExplainRequest>) {
    return this.ai.explain(b);
  }

  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @PartnerScope('scam:check')
  @Post('scam-check')
  @HttpCode(200)
  scam(@ZBody(ScamCheckBody) b: z.infer<typeof ScamCheckBody>) {
    return this.ai.scamCheck(b.text, b.district);
  }

  /** The fixed synthetic set (with freshly sealed genuine ones) that the Scam Map demo button sends. */
  @Roles('admin')
  @Get('scam-samples')
  scamSamples() {
    return this.ai.scamSamples();
  }

  /** "Show this to an officer": records a PII-masked report an officer labels on the Scam Map. */
  @Roles('citizen', 'helper')
  @Post('scam-report')
  @HttpCode(200)
  scamReport(
    @CurrentUser() user: AuthUser,
    @ZBody(ScamReportBody) b: z.infer<typeof ScamReportBody>,
  ) {
    return this.ai.scamReport(b, user);
  }

  /**
   * Ask Haqdaar: an agent that answers a citizen's question by calling read-only tools as her
   * (policy search, her claims, her payments, message check). At most three calls; it cannot
   * approve, pay or change anything. `steps` lists what it checked.
   */
  @Roles('citizen', 'helper')
  @Post('assist')
  @HttpCode(200)
  assist(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @ZBody(AssistBody) b: z.infer<typeof AssistBody>,
  ) {
    // RolesGuard only lets a signed-in citizen or helper through, so the header is her own valid token.
    return this.ai.assist(b.question, b.lang, user, req.headers.authorization ?? '', req.id);
  }

  /**
   * Text → speech (audio/mpeg) in a Pakistani Urdu voice, for people who cannot read.
   * 503 with `details.fallback = "browser"` means: use the phone's own voice instead.
   */
  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @Post('speak')
  @HttpCode(200)
  @Header('content-type', 'audio/mpeg')
  @Header('cache-control', 'private, max-age=86400')
  async speak(@ZBody(SpeakBody) b: z.infer<typeof SpeakBody>) {
    const { audio } = await this.ai.speak(b.text, b.lang);
    return new StreamableFile(audio, { type: 'audio/mpeg', length: audio.length });
  }

  /** Urdu speech → text. multipart/form-data with field `file` (max 5 MB, audio only). */
  @Roles('citizen', 'helper', 'officer')
  @ApiConsumes('multipart/form-data')
  @Post('transcribe')
  @HttpCode(200)
  async transcribe(@Req() req: FastifyRequest) {
    if (!req.isMultipart())
      throw new BadRequestException('Send the audio as multipart/form-data (field "file")');
    const file = await req.file();
    if (!file) throw new BadRequestException('Audio file is required (field "file")');
    const mime = file.mimetype.split(';')[0]!;
    if (!AUDIO_TYPES.includes(mime))
      throw new BadRequestException(`Unsupported audio type: ${mime}`);
    return this.ai.transcribe(await readLimited(file, 'Audio'), mime);
  }

  /**
   * CNIC photo checks (OCR, QR, ELA forgery, EXIF, blur, cross-checks). multipart/form-data:
   * `file` (JPEG/PNG by content, max 5 MB) and optional `cnic` the citizen typed.
   * Never rejects on heuristics: doubt → `needsHuman`, blurry → `retakeRequired`.
   */
  @Roles('citizen', 'helper', 'officer')
  @ApiConsumes('multipart/form-data')
  @Post('document-check')
  @HttpCode(200)
  async documentCheck(@Req() req: FastifyRequest) {
    let image: Buffer | undefined;
    let typed: string | undefined;
    if (!req.isMultipart())
      throw new BadRequestException('Send the photo as multipart/form-data (field "file")');
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await readLimited(part, 'Image');
        if (part.fieldname === 'file') image = buf;
      } else if (part.fieldname === 'cnic' && typeof part.value === 'string' && part.value.trim()) {
        typed = part.value.trim();
      }
    }
    if (!image) throw new BadRequestException('Image file is required (field "file")');
    const cnic = typed === undefined ? undefined : TypedCnic.safeParse(typed);
    if (cnic && !cnic.success) throw new BadRequestException('cnic must look like 12345-1234567-1');
    return this.ai.documentCheck(image, cnic?.data);
  }

  /** Internal-only: knowledge service routes Gemini embeddings through AiRouter. */
  @InternalOnly()
  @Post('embed')
  @HttpCode(200)
  embed(@ZBody(EmbedBody) body: z.infer<typeof EmbedBody>) {
    return this.ai.embed(body.text, body.taskType);
  }

  /** Internal-only source grounded answer task; quotes must occur verbatim in supplied sources. */
  @InternalOnly()
  @Post('answer-from-sources')
  @HttpCode(200)
  answerFromSources(@ZBody(AnswerSourcesBody) body: z.infer<typeof AnswerSourcesBody>) {
    return this.ai.answerFromSources(body.question, body.sources);
  }
}
