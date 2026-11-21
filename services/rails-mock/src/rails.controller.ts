import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { setTimeout as sleep } from 'node:timers/promises';
import { InternalOnly, Roles, ZBody, ZodPipe, ZQuery } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { RailsStore } from './rails.store';
import { SimulatedLatency } from './latency.interceptor';
import {
  Alias,
  Cnic,
  FaultsBody,
  NadraVerifyBody,
  SmsSendBody,
  StatementQuery,
  TitleFetchBody,
  TransferBody,
} from './schemas';

@ApiTags('nadra')
@ApiSecurity('internal')
@InternalOnly()
@UseInterceptors(SimulatedLatency)
@Controller('mock')
export class NadraController {
  constructor(private readonly rails: RailsStore) {}

  @Post('nadra/verify')
  @HttpCode(200)
  verify(@ZBody(NadraVerifyBody) b: z.infer<typeof NadraVerifyBody>) {
    return this.rails.verifyNadra(b.cnic, b.fullName);
  }

  @Get('household/:cnic')
  household(@Param('cnic', new ZodPipe(Cnic)) cnic: string) {
    const h = this.rails.household(cnic);
    if (!h) throw new NotFoundException('No household record');
    return h;
  }
}

@ApiTags('raast')
@ApiSecurity('internal')
@InternalOnly()
@UseInterceptors(SimulatedLatency)
@Controller('mock/raast')
export class RaastController {
  constructor(private readonly rails: RailsStore) {}

  @Post('title-fetch')
  @HttpCode(200)
  titleFetch(@ZBody(TitleFetchBody) b: z.infer<typeof TitleFetchBody>) {
    return this.rails.titleFetch(b);
  }

  @Post('transfer')
  @HttpCode(200)
  async transfer(@ZBody(TransferBody) b: z.infer<typeof TransferBody>) {
    const { result, delayMs } = this.rails.transfer(b);
    if (delayMs) await sleep(delayMs);
    return result;
  }

  @Get('status/:endToEndId')
  status(@Param('endToEndId') endToEndId: string) {
    return this.rails.status(endToEndId);
  }

  @Get('statement')
  statement(@ZQuery(StatementQuery) q: z.infer<typeof StatementQuery>) {
    return this.rails.statement(q.date);
  }
}

@ApiTags('sms')
@ApiBearerAuth()
@UseInterceptors(SimulatedLatency)
@Controller('mock/sms')
export class SmsController {
  constructor(private readonly rails: RailsStore) {}

  @ApiSecurity('internal')
  @InternalOnly()
  @Post('send')
  @HttpCode(200)
  send(@ZBody(SmsSendBody) b: z.infer<typeof SmsSendBody>) {
    return this.rails.sendSms(b.to, b.body);
  }

  /**
   * Mock phone screen (Judge Mode). Admin-only: the token carries no phone number (PII stays out
   * of JWTs), so a citizen could otherwise read anyone's messages.
   */
  @Roles('admin')
  @Get('inbox/:phone')
  inbox(@Param('phone', new ZodPipe(Alias)) phone: string) {
    return this.rails.inbox(phone);
  }
}

/** Judge Mode: make Raast fail, time out or send a bad statement on purpose. */
@ApiTags('faults')
@ApiBearerAuth()
@Roles('admin')
@Controller('mock/faults')
export class FaultsController {
  constructor(private readonly rails: RailsStore) {}

  @Get()
  get() {
    return this.rails.getFaults();
  }

  @Post()
  @HttpCode(200)
  set(@ZBody(FaultsBody) b: z.infer<typeof FaultsBody>) {
    return this.rails.setFaults(b);
  }
}
