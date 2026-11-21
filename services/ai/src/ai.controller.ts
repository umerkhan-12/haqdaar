import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import {
  CurrentPrincipal,
  InternalOnly,
  PartnerScope,
  Roles,
  ZBody,
  type Principal,
} from '@haqdaar/nest-kit';
import { ScamCheckRequest } from '@haqdaar/shared';
import { z } from 'zod';
import { AiService } from './ai.service';

const ProfileBody = z.object({ profile: z.enum(['dev', 'demo', 'offline']) });
const KillBody = z.object({ killed: z.boolean() });
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
  constructor(private readonly ai: AiService) {}

  /** Active profile, provider chain with circuit states, stats. */
  @Roles('admin', 'auditor', 'officer')
  @Get('status')
  status() {
    return this.ai.status();
  }

  /** Switch AI profile at runtime (e.g. to `demo` on judging day). Logged. */
  @Roles('admin')
  @Post('profile')
  @HttpCode(200)
  setProfile(@CurrentPrincipal() p: Principal, @ZBody(ProfileBody) b: z.infer<typeof ProfileBody>) {
    return this.ai.setProfile(b.profile, p);
  }

  /** Kill AI: every AI answer becomes "not sure"; the system keeps working through humans. */
  @Roles('admin')
  @Post('kill-switch')
  @HttpCode(200)
  kill(@CurrentPrincipal() p: Principal, @ZBody(KillBody) b: z.infer<typeof KillBody>) {
    return this.ai.setKilled(b.killed, p);
  }

  @Roles('citizen', 'helper', 'officer')
  @Post('extract-claim')
  @HttpCode(200)
  extract(@ZBody(ExtractBody) b: z.infer<typeof ExtractBody>) {
    return this.ai.extractClaim(b.transcript);
  }

  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @PartnerScope('scam:check')
  @Post('scam-check')
  @HttpCode(200)
  scam(@ZBody(ScamCheckRequest) b: z.infer<typeof ScamCheckRequest>) {
    return this.ai.scamCheck(b.text);
  }

  /** Urdu speech → text. multipart/form-data with field `file` (max 5 MB, audio only). */
  @Roles('citizen', 'helper', 'officer')
  @ApiConsumes('multipart/form-data')
  @Post('transcribe')
  @HttpCode(200)
  async transcribe(@Req() req: FastifyRequest) {
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
