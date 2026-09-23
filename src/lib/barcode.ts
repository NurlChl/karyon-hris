const CODE39_MAP: Record<string, string> = {
  '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101',
  '4': '101001101011', '5': '110100110101', '6': '101100110101', '7': '101001011011',
  '8': '110100101101', '9': '101100101101', 'A': '110101001011', 'B': '101101001011',
  'C': '110110100101', 'D': '101011001011', 'E': '110101100101', 'F': '101011001101',
  'G': '101010011011', 'H': '110101001101', 'I': '101101001101', 'J': '101011001101',
  'K': '110101010011', 'L': '101101010011', 'M': '110110101001', 'N': '101011010011',
  'O': '110101101001', 'P': '101011101001', 'Q': '101010110011', 'R': '110101011001',
  'S': '101101011001', 'T': '101011011001', 'U': '110010101011', 'V': '100110101011',
  'W': '110011010101', 'X': '100101101011', 'Y': '110010110101', 'Z': '100110110101',
  '-': '100101011011', '.': '110010101101', ' ': '100110101101', '*': '100101101101'
};

export function generateCode39Svg(text: string): { svg: string; width: number; height: number } {
  const normalized = `*${text.toUpperCase()}*`;
  let bitstring = "";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const pattern = CODE39_MAP[char] || CODE39_MAP[' '];
    bitstring += pattern + "0"; // separator space between characters
  }

  const barWidth = 2;
  const height = 45;
  const totalWidth = bitstring.length * barWidth;

  let rects = "";
  let x = 0;

  for (let i = 0; i < bitstring.length; i++) {
    if (bitstring[i] === "1") {
      rects += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="currentColor" />`;
    }
    x += barWidth;
  }

  const svg = `<svg viewBox="0 0 ${totalWidth} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="text-slate-800 dark:text-slate-200">${rects}</svg>`;

  return { svg, width: totalWidth, height };
}
