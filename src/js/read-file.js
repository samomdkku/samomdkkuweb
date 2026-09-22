// ==============================================
// READ-FILE — reading a picked File, with a failure a person can act on.
//
// WHY THIS EXISTS. A picked File is a HANDLE to bytes that live somewhere else
// (the phone's photo library, a cloud provider, a temp copy), not the bytes.
// Reading it again later can fail with NotReadableError: the OS revoked access
// while the student was in their bank app, or the file changed after it was
// picked. The slip preview reads at pick time and succeeded; the upload read
// at submit time and failed. And because FileReader's `onerror` hands over a
// ProgressEvent (no `.message`), `r.onerror = reject` put
// "สั่งซื้อไม่สำเร็จ: [object ProgressEvent]" on a student's screen
// (2026-09-22, reproduced in Chrome by changing the file after the preview).
// ==============================================

export const FILE_UNREADABLE_MESSAGE =
  'อ่านไฟล์ที่เลือกไว้ไม่ได้แล้ว (ไฟล์อาจถูกย้ายหรือแก้ไขหลังจากเลือก) กรุณาเลือกไฟล์ใหม่อีกครั้ง';

/** Read a File/Blob as a data: URL. Always rejects with an Error. */
export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => {
      console.warn('[read-file] read failed:', r.error?.name, r.error?.message);
      reject(new Error(FILE_UNREADABLE_MESSAGE));
    };
    r.readAsDataURL(file);
  });
}

/**
 * Copy a picked File's bytes into memory, so a later read cannot go stale.
 * Use it where the file is picked long before it is sent (a checkout that
 * waits for the buyer to fill the rest of a form). Rejects with an Error
 * carrying FILE_UNREADABLE_MESSAGE when even this first read fails.
 */
export async function holdInMemory(file) {
  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch (e) {
    console.warn('[read-file] hold failed:', e?.name, e?.message);
    throw new Error(FILE_UNREADABLE_MESSAGE);
  }
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}
