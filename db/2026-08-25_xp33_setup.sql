-- Einrichtung: Allianz XP33, Ben als Admin dort, binabean als Admin in AR1S.
-- 25.08.2026 — gehört zu 2026-08-25_multi_alliance.sql.

begin;

insert into alliances(tag,name,server)
  values('XP33',null,'#1668')
  on conflict(tag) do nothing;

-- Ben in XP33: dasselbe Profil samt Passwort, aber ohne Historie — Teilnahmen und
-- Stärkeverlauf gehören zu AR1S, dort sind sie entstanden. Die AR1S-Zeile bleibt
-- stehen, sonst verlöre die Statistik dieser Allianz ihre Namenszuordnung.
insert into ws_players(alliance_id,name,role,profession,active,access_enabled,
                       password_hash,super_admin,alliance_admin,ws_admin,profile_edit,
                       can_reset_password,t1,t2,t3,t4,total_power,hero_power,level,gender,avatar_url)
select (select id from alliances where tag='XP33'),
       p.name,p.role,p.profession,true,p.access_enabled,
       p.password_hash,
       -- Super-Admin auf beiden Zeilen: sonst hinge der Zugang zu allen Allianzen
       -- daran, dass die AR1S-Zeile nie aufgeräumt wird.
       true,
       true,          -- alliance_admin: verwaltet XP33
       true,true,true,
       p.t1,p.t2,p.t3,p.t4,p.total_power,p.hero_power,p.level,p.gender,p.avatar_url
  from ws_players p
 where p.name='Ben_the_men'
   and p.alliance_id=(select id from alliances where tag='AR1S')
on conflict do nothing;

-- binabean übernimmt AR1S. alliance_admin ist bewusst getrennt vom Spielrang:
-- wechselt der Rang im Spiel, bleibt das Verwaltungsrecht am Werkzeug bestehen.
update ws_players
   set alliance_admin=true, ws_admin=true, profile_edit=true, access_enabled=true
 where name='binabean'
   and alliance_id=(select id from alliances where tag='AR1S');

commit;

notify pgrst, 'reload schema';
