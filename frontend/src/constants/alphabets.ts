/**
 * A field of alphabet characters across India's major scripts — the raw
 * material for the splash "wall of languages" (Sarvam-style). Interleaved
 * round-robin so adjacent cells are from different scripts.
 */
const SCRIPTS: string[][] = [
  // Devanagari (Hindi / Marathi)
  "अ आ इ उ ए क ख ग घ च ज ट ठ ड त द न प ब म य र ल व श स ह".split(" "),
  // Tamil
  "அ ஆ இ ஈ உ எ ஒ க ங ச ஞ ட ண த ந ப ம ய ர ல வ ழ ள ற ன".split(" "),
  // Telugu
  "అ ఆ ఇ ఈ ఉ ఎ క ఖ గ చ జ ట డ త ద న ప బ మ య ర ల వ శ స హ".split(" "),
  // Kannada
  "ಅ ಆ ಇ ಈ ಉ ಎ ಕ ಖ ಗ ಚ ಜ ಟ ಡ ತ ದ ನ ಪ ಬ ಮ ಯ ರ ಲ ವ ಶ ಸ ಹ".split(" "),
  // Bengali
  "অ আ ই উ এ ক খ গ ঘ চ ছ জ ট ড ত দ ন প ব ম য র ল শ স হ".split(" "),
  // Malayalam
  "അ ആ ഇ ഈ ഉ എ ക ഖ ഗ ച ജ ട ഡ ണ ത ദ ന പ ബ മ യ ര ല വ സ ഹ".split(" "),
  // Gujarati
  "અ આ ઇ ઈ ઉ એ ક ખ ગ ચ છ જ ટ ડ ત દ ન પ બ મ ય ર લ વ શ સ હ".split(" "),
  // Gurmukhi (Punjabi)
  "ੳ ਅ ੲ ਸ ਹ ਕ ਖ ਗ ਘ ਚ ਛ ਜ ਟ ਠ ਡ ਤ ਦ ਨ ਪ ਬ ਮ ਯ ਰ ਲ ਵ".split(" "),
  // Odia
  "ଅ ଆ ଇ ଈ ଉ ଏ କ ଖ ଗ ଚ ଜ ଟ ଡ ତ ଦ ନ ପ ବ ମ ଯ ର ଲ ଵ ଷ ସ ହ".split(" "),
  // Urdu / Arabic
  "ا ب پ ت ٹ ث ج چ ح خ د ذ ر ز س ش ص ط ع ف ق ک گ ل م ن و ہ ی".split(" "),
  // Latin (English)
  "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z".split(" "),
];

function interleave(rows: string[][]): string[] {
  const out: string[] = [];
  const max = Math.max(...rows.map((r) => r.length));
  for (let i = 0; i < max; i++) {
    for (const row of rows) {
      if (i < row.length) out.push(row[i]);
    }
  }
  return out;
}

export const ALPHABET_GLYPHS: string[] = interleave(SCRIPTS);
