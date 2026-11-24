import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { WebhooksService } from './webhooks.service';

const SUPPORTED_EVENTS = ['payments.payment.state_changed'] as const;

const CreateBody = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((u) => u.startsWith('https://'), 'Webhook URL must use https'),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
});

@ApiTags('webhooks')
@ApiBearerAuth()
@Roles('admin')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(CreateBody) b: z.infer<typeof CreateBody>) {
    return this.webhooks.create(user.tenantId, b.url, b.events, user.id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.webhooks.list(user.tenantId);
  }

  /** Turns the webhook off for good; its delivery history stays readable. */
  @Delete(':id')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.deactivate(user.tenantId, id);
  }

  @Get(':id/deliveries')
  deliveries(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.deliveries(user.tenantId, id);
  }

  @Post('deliveries/:id/resend')
  @HttpCode(200)
  resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.resend(user.tenantId, id);
  }
}
