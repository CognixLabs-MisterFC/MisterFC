'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  currentTeamId: string;
  teams: Array<{ id: string; name: string }>;
};

export function TeamSelector({ currentTeamId, teams }: Props) {
  const t = useTranslations('mi_plantilla');
  const router = useRouter();

  function onChange(teamId: string) {
    router.push(`/mi-plantilla?team=${teamId}`);
  }

  return (
    <Select value={currentTeamId} onValueChange={onChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder={t('select_team')} />
      </SelectTrigger>
      <SelectContent>
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
