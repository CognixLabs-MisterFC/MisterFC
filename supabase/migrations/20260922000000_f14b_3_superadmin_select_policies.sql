-- F14B-3 — Parche de las 2 políticas SELECT que consultan memberships INLINE.
--
-- F14B-2 cableó is_superadmin() en user_role_in_club, pero estas dos políticas
-- NO pasan por ese helper (consultan memberships directamente), así que dejaban
-- al superadmin sin visibilidad en profiles y legal_documents. Se les añade
-- `or public.is_superadmin()` a su USING; el resto de la condición queda IGUAL.
--
-- Barrido re-confirmado sobre la BD viva: para SELECT son EXACTAMENTE estas dos
-- (el otro hit con memberships inline, team_staff_insert_invitee, es INSERT y no
-- afecta la visibilidad de lectura del superadmin).
--
-- ALCANCE ESTRICTO: solo estas dos políticas. No se tocan RPCs admin (F14B-6),
-- ni auditoría (F14B-4), ni consola, ni ninguna otra política.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles_select_clubmate — ver profiles de quienes comparten club (+ superadmin).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy profiles_select_clubmate on public.profiles;
create policy profiles_select_clubmate on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m_self
      join public.memberships m_other on m_other.club_id = m_self.club_id
      where m_self.profile_id = auth.uid()
        and m_other.profile_id = public.profiles.id
    )
    or public.is_superadmin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. legal_documents_select_own_club — ver los textos legales de tu club (+ superadmin).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy legal_documents_select_own_club on public.legal_documents;
create policy legal_documents_select_own_club on public.legal_documents
  for select to authenticated
  using (
    club_id in (select club_id from public.memberships where profile_id = auth.uid())
    or public.is_superadmin()
  );
