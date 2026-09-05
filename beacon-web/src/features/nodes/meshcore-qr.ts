// Dependency-free QR renderer for MeshCore contact URIs: draws the payload as a QR code onto a
// canvas locally in the browser (no third-party service ever sees the node identity).
// Compact implementation: byte-mode QR with automatic version + medium error correction.

const ECC_CODEWORDS_PER_BLOCK = [
  [19, 34, 55, 80, 108, 136, 156, 194, 224, 274, 324],
  [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254],
  [13, 22, 36, 52, 72, 88, 102, 124, 144, 172, 202],
];

const ECC_BLOCKS = [
  [1, 1, 1, 1, 1, 2, 2, 4, 4, 4, 4],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5],
  [1, 1, 2, 2, 4, 4, 4, 5, 6, 8, 8],
];

const ECC_LEVEL = 1; // medium

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function reedSolomonDivisor(degree: number): number[] {
  let result = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j++) {
      next[j] ^= gfMul(result[j]!, gfExp(i));
      next[j + 1] ^= result[j]!;
    }
    result = next;
  }
  return result;
}

function gfMul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x11d;
    b >>= 1;
  }
  return p;
}

function gfExp(i: number): number {
  let r = 1;
  for (let k = 0; k < i; k++) r = gfMul(r, 2);
  return r;
}

function totalDataCodewords(version: number): number {
  const eccIdx = ECC_LEVEL;
  const blocks = ECC_BLOCKS[eccIdx]![version - 1]!;
  const perBlock = ECC_CODEWORDS_PER_BLOCK[eccIdx]![version - 1]!;
  return blocks * perBlock;
}

function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function dataCapacityBits(version: number): number {
  return totalDataCodewords(version) * 8;
}

function pickVersion(dataLen: number): number {
  for (let v = 1; v <= 11; v++) {
    const capacity = dataCapacityBits(v) - 4 - charCountBits(v);
    if (dataLen * 8 <= capacity) return v;
  }
  throw new Error('payload too large for QR');
}

function buildBitStream(data: number[], version: number): boolean[] {
  const bits: boolean[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push(((value >> i) & 1) === 1);
  };
  push(0b0100, 4); // byte mode
  push(data.length, charCountBits(version));
  for (const b of data) push(b, 8);
  const capacity = dataCapacityBits(version);
  const terminator = Math.min(4, capacity - bits.length);
  for (let i = 0; i < terminator; i++) bits.push(false);
  while (bits.length % 8 !== 0) bits.push(false);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j]! ? 1 : 0);
    bytes.push(v);
  }
  const total = totalDataCodewords(version);
  const pads = [0xec, 0x11];
  for (let i = bytes.length; i < total; i++) bytes.push(pads[(i - bytes.length) % 2]!);
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ECC_LEVEL]![version - 1]!;
  const blocks = ECC_BLOCKS[ECC_LEVEL]![version - 1]!;
  const dataPerBlock = total / blocks;
  const divisor = reedSolomonDivisor(eccPerBlock);
  const out: boolean[] = [];
  const blockBytes: number[][] = [];
  for (let b = 0; b < blocks; b++) {
    blockBytes.push(bytes.slice(b * dataPerBlock, (b + 1) * dataPerBlock));
  }
  // interleave data codewords, then ECC codewords
  const eccBlocks: number[][] = blockBytes.map((block) => {
    const ecc: number[] = new Array(eccPerBlock).fill(0);
    const data = [...block, ...new Array(eccPerBlock).fill(0)];
    for (let i = 0; i < block.length; i++) {
      const factor = data[0]!;
      data.shift();
      for (let j = 0; j < divisor.length - 1; j++) data[j]! ^= gfMul(divisor[j]!, factor);
    }
    for (let i = 0; i < eccPerBlock; i++) ecc[i] = data[i]!;
    return ecc;
  });
  const flat: number[] = [];
  for (let i = 0; i < dataPerBlock; i++)
    for (let b = 0; b < blocks; b++) flat.push(blockBytes[b]![i]!);
  for (let i = 0; i < eccPerBlock; i++)
    for (let b = 0; b < blocks; b++) flat.push(eccBlocks[b]![i]!);
  for (const v of flat) for (let i = 7; i >= 0; i--) out.push(((v >> i) & 1) === 1);
  // remainder bits for versions 2-11
  const remainder = [7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0][version - 1]!;
  for (let i = 0; i < remainder; i++) out.push(false);
  return out;
}

function buildMatrix(version: number, dataBits: boolean[]): boolean[][] {
  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array(size).fill(null),
  );
  const isFunc: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  function setFunc(r: number, c: number, dark: boolean) {
    modules[r]![c] = dark;
    isFunc[r]![c] = true;
  }

  function finder(r: number, c: number) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const dark =
          (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
          (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        setFunc(rr, cc, dark);
      }
    }
  }

  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (modules[6]![i] === null) setFunc(6, i, i % 2 === 0);
    if (modules[i]![6] === null) setFunc(i, 6, i % 2 === 0);
  }

  // alignment patterns (versions >= 2, single center for 2-6)
  if (version >= 2) {
    const pos = [6, size - 7];
    for (const r of pos) {
      for (const c of pos) {
        if (modules[r]![c] !== null) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunc(r + dr, c + dc, dark);
          }
        }
      }
    }
  }

  // format info placeholder (overwritten below) + dark module
  setFunc(size - 8, 8, true);

  // reserve format info areas
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]; // ECC M, mask 0
  for (let i = 0; i < 6; i++) {
    setFunc(8, i, formatBits[i] === 1);
    setFunc(i, 8, formatBits[i] === 1);
  }
  setFunc(8, 7, formatBits[6] === 1);
  setFunc(7, 8, formatBits[6] === 1);
  for (let i = 0; i < 6; i++) {
    setFunc(size - 1 - i, 8, formatBits[i + 9] === 1);
    setFunc(8, size - 1 - i, formatBits[i + 9] === 1);
  }
  setFunc(8, size - 8, formatBits[8] === 1);
  setFunc(size - 7, 8, formatBits[7] === 1);
  setFunc(size - 8, 8, true); // dark module wins

  // data placement with mask 0: (r + c) % 2 === 0
  let bit = 0;
  let upward = true;
  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) c = 5;
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (let cc = 0; cc < 2; cc++) {
        const col = c - cc;
        if (modules[r]![col] !== null) continue;
        let dark = bit < dataBits.length ? dataBits[bit]! : false;
        if ((r + col) % 2 === 0) dark = !dark; // mask 0
        modules[r]![col] = dark;
        bit++;
      }
    }
    upward = !upward;
  }

  return modules as boolean[][];
}

export function qrMatrix(text: string): boolean[][] {
  const data = utf8Bytes(text);
  const version = pickVersion(data.length);
  const bits = buildBitStream(data, version);
  return buildMatrix(version, bits);
}

export function drawQr(canvas: HTMLCanvasElement, text: string, scale = 4): void {
  const matrix = qrMatrix(text);
  const size = matrix.length;
  const quiet = 2;
  canvas.width = (size + quiet * 2) * scale;
  canvas.height = (size + quiet * 2) * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const fg =
    getComputedStyle(document.documentElement).getPropertyValue('--color-text-bright').trim() ||
    '#000';
  const bg = '#ffffff';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r]![c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}
