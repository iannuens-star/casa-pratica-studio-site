// Cabeçalho Range (um intervalo só). O player do iPhone exige respostas 206 corretas.
export function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h).trim());
  if (!m || (m[1] === "" && m[2] === "") || size <= 0) return null;
  let start, end;
  if (m[1] === "") { // sufixo: últimos N bytes
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}
