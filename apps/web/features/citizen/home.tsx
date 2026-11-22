'use client';

import { CitizenShell } from '@/components/citizen-shell';
import { IconLock, IconMessage, IconMic, IconShield, IconWallet } from '@/components/icons';
import { AudioButton, BigActionCard } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export function CitizenHome() {
  const { t } = useI18n();
  return (
    <CitizenShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('homeGreeting')}</h1>
        <AudioButton
          text={`${t('homeGreeting')}. ${t('claim')}. ${t('status')}. ${t('scam')}. ${t('askTitle')}. ${t('myData')}`}
          className="text-brand"
        />
      </div>
      <nav className="space-y-4" aria-label={t('appName')}>
        <BigActionCard href="/citizen/claim" icon={IconMic} label={t('claim')} tone="info" />
        <BigActionCard
          href="/citizen/status"
          icon={IconWallet}
          label={t('status')}
          tone="neutral"
        />
        <BigActionCard href="/citizen/scam" icon={IconShield} label={t('scam')} tone="warn" />
        <BigActionCard href="/citizen/ask" icon={IconMessage} label={t('askTitle')} tone="info" />
        <BigActionCard
          href="/citizen/consents"
          icon={IconLock}
          label={t('myData')}
          tone="neutral"
        />
      </nav>
    </CitizenShell>
  );
}
