export const DOCUMENT_QUALITY_SCHEMA=`CREATE TABLE IF NOT EXISTS wa_document_quality_reviews (
  owner_phone TEXT NOT NULL,document_id TEXT NOT NULL,status TEXT NOT NULL,
  reason TEXT NOT NULL,replacement_job_id TEXT,reviewed_at TEXT NOT NULL,
  PRIMARY KEY(owner_phone,document_id))`;
export async function ensureDocumentQuality(db){await db.prepare(DOCUMENT_QUALITY_SCHEMA).bind().run();}
export async function requireDocumentQuality(db,owner,id){
  await ensureDocumentQuality(db);
  const review=await db.prepare('SELECT status FROM wa_document_quality_reviews WHERE owner_phone=? AND document_id=?').bind(owner,id).first();
  if(review && ['invalid','superseded'].includes(review.status))throw Error('document_quality_rejected');
}
export const validDocumentFilter=`NOT EXISTS (SELECT 1 FROM wa_document_quality_reviews q
  WHERE q.owner_phone=d.owner_phone AND q.document_id=d.id AND q.status IN ('invalid','superseded'))`;
