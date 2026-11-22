import { Module } from '@nestjs/common';
import { KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { PrismaService } from './prisma.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'knowledge',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
  ],
  controllers: [KnowledgeController],
  providers: [PrismaService, KnowledgeService],
})
export class AppModule {}
