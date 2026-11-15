// herdr-keys-io: herdr-keys.mjs 가 쓰는 "실제 디스크" 입출력. 시험에서 직접 불러 쓸 수 있게 따로 둔다.
// write(path, text, expected) 규칙은 허더의 writeTextFile 과 같다: expected 가 null 이면 새 파일만(이미 있으면 거절), 아니면 지금 내용이 expected 와 같을 때만 쓴다(아니면 거절).
// 교체는 임시 파일에 쓴 뒤 이름을 바꿔 한 번에 한다(중간 상태가 보이지 않음).
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';

export const decode = (buf) => new TextDecoder('utf-8', { fatal: true }).decode(buf);

export const diskIO = {
  read: async (p) => (existsSync(p) ? decode(readFileSync(p)) : null),
  write: async (p, text, expected) => {
    if (expected === null) { writeFileSync(p, text, { flag: 'wx' }); return null; }                 // 새 파일(이미 있으면 거절)
    if (!existsSync(p) || decode(readFileSync(p)) !== expected) throw new Error('읽은 뒤에 파일이 바뀌었습니다');
    const tmp = `${p}.tmp-orch-${process.pid}`;
    writeFileSync(tmp, text);
    try { renameSync(tmp, p); } catch (e) { try { unlinkSync(tmp); } catch { /* 이미 없음 */ } throw e; }
    return null;
  },
};
