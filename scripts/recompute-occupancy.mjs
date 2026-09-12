/**
 * Recompute owner-occupancy and owner type for every stored parcel.
 *
 * absentee_owner and owner_is_org are derived columns: they are decided at
 * ingest by src/owner-type.ts and then frozen into the row. So every fix to
 * that classifier leaves the already-loaded counties wrong until they are
 * recomputed, and re-ingesting a county to correct a boolean means refetching
 * hundreds of thousands of features from someone else's ArcGIS service.
 *
 * This reads the source columns back out and reapplies the current rules. It
 * is idempotent and safe to run after any change to the classifier.
 *
 *   DATABASE_URL=... node --experimental-strip-types scripts/recompute-occupancy.mjs [--apply]
 *
 * Without --apply it reports what would change and writes nothing.
 */
import { neon } from '@neondatabase/serverless';
import { isAbsenteeOwner, looksLikeOrganization } from '../src/owner-type.ts';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = neon(url);

const rows = await sql`
  SELECT id, county_fips, owner_name, site_address, mail_address,
         absentee_owner, owner_is_org
  FROM parcels
`;

const changes = [];
const byCounty = {};
for (const r of rows) {
  const absentee = isAbsenteeOwner(r.site_address, r.mail_address);
  const isOrg = looksLikeOrganization(r.owner_name);
  const stat = (byCounty[r.county_fips] ??= { rows: 0, occupancy: 0, ownerType: 0 });
  stat.rows++;
  if (absentee !== r.absentee_owner || isOrg !== r.owner_is_org) {
    if (absentee !== r.absentee_owner) stat.occupancy++;
    if (isOrg !== r.owner_is_org) stat.ownerType++;
    changes.push({ id: r.id, absentee, isOrg });
  }
}

console.table(byCounty);
console.log(`${changes.length} of ${rows.length} rows differ from the current rules`);

if (!changes.length) process.exit(0);
if (!APPLY) {
  console.log('dry run — pass --apply to write');
  process.exit(0);
}

// Batched so one statement does not carry a hundred thousand parameters, and
// so a failure part-way leaves a known number of rows corrected rather than an
// unknown one.
const BATCH = 500;
let written = 0;
for (let i = 0; i < changes.length; i += BATCH) {
  const batch = changes.slice(i, i + BATCH);
  const values = batch
    .map((_, n) => `($${n * 3 + 1}, $${n * 3 + 2}::boolean, $${n * 3 + 3}::boolean)`)
    .join(', ');
  const params = batch.flatMap((c) => [c.id, c.absentee, c.isOrg]);
  const result = await sql.query(
    `UPDATE parcels AS p
        SET absentee_owner = v.absentee, owner_is_org = v.is_org
       FROM (VALUES ${values}) AS v(id, absentee, is_org)
      WHERE p.id = v.id`,
    params
  );
  written += batch.length;
  process.stdout.write(`\r  ${written}/${changes.length} corrected`);
}
console.log(`\ndone — ${written} rows corrected`);
