// Empaquetado Ogg de paquetes Opus, según RFC 3533 (Ogg) y RFC 7845 (Opus en Ogg).
//
// WhatsApp sólo muestra la burbuja de nota de voz con un archivo Ogg cuyo
// contenido sea Opus y en un solo canal. Aquí se construye ese archivo a partir
// de los paquetes que devuelve el codificador: no hay transcodificación ni
// dependencia externa, sólo cabeceras, tabla de segmentos y suma de control.

export const OPUS_SAMPLE_RATE = 48_000;
export const OPUS_FRAME_SAMPLES = 960; // 20 ms a 48 kHz.

// CRC de Ogg: polinomio 0x04c11db7 sin reflejar, sin valor inicial ni final.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0;
  for (const byte of bytes) value = ((value << 8) ^ CRC_TABLE[((value >>> 24) ^ byte) & 0xff]) >>> 0;
  return value >>> 0;
}

/** Tabla de lacing: todo paquete se parte en tramos de 255 y uno final menor. */
function lacing(packets) {
  const segments = [];
  for (const packet of packets) {
    let remaining = packet.length;
    while (remaining >= 255) { segments.push(255); remaining -= 255; }
    segments.push(remaining);
  }
  return segments;
}

function page({ packets, serial, sequence, granule, continued = false, first = false, last = false }) {
  const segments = lacing(packets);
  if (segments.length > 255) throw new RangeError('ogg_page_too_many_segments');
  const payload = packets.reduce((total, packet) => total + packet.length, 0);
  const bytes = new Uint8Array(27 + segments.length + payload);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  bytes[4] = 0;
  bytes[5] = (continued ? 1 : 0) | (first ? 2 : 0) | (last ? 4 : 0);
  // La posición granular es de 64 bits; se escribe en dos mitades little-endian.
  view.setUint32(6, granule >>> 0, true);
  view.setUint32(10, Math.floor(granule / 2 ** 32) >>> 0, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint32(22, 0, true); // La suma de control se calcula con este campo a cero.
  bytes[26] = segments.length;
  bytes.set(segments, 27);
  let at = 27 + segments.length;
  for (const packet of packets) { bytes.set(packet, at); at += packet.length; }
  view.setUint32(22, crc32(bytes), true);
  return bytes;
}

function opusHead(channels, preSkip, inputSampleRate) {
  const bytes = new Uint8Array(19);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  bytes[8] = 1;
  bytes[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputSampleRate, true);
  view.setUint16(16, 0, true); // Sin ganancia de salida.
  bytes[18] = 0; // Familia de mapeo 0: mono o estéreo.
  return bytes;
}

function opusTags(vendor) {
  const name = new TextEncoder().encode(vendor);
  const bytes = new Uint8Array(8 + 4 + name.length + 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // "OpusTags"
  view.setUint32(8, name.length, true);
  bytes.set(name, 12);
  view.setUint32(12 + name.length, 0, true); // Sin comentarios de usuario.
  return bytes;
}

/**
 * Construye el archivo Ogg completo.
 * `packets` son paquetes Opus de duración fija (`frameSamples` a 48 kHz).
 */
export function oggOpusFile(packets, { channels = 1, preSkip = 312, frameSamples = OPUS_FRAME_SAMPLES,
  serial = 1, vendor = 'brivany', packetsPerPage = 50 } = {}) {
  if (!Array.isArray(packets) || !packets.length) throw new TypeError('ogg_without_packets');
  if (channels !== 1 && channels !== 2) throw new TypeError('ogg_invalid_channels');
  if (!Number.isInteger(preSkip) || preSkip < 0 || preSkip > 65_535) throw new TypeError('ogg_invalid_preskip');
  if (!Number.isInteger(serial) || serial < 0 || serial > 0xffffffff) throw new TypeError('ogg_invalid_serial');

  const pages = [
    page({ packets: [opusHead(channels, preSkip, OPUS_SAMPLE_RATE)], serial, sequence: 0, granule: 0, first: true }),
    page({ packets: [opusTags(vendor)], serial, sequence: 1, granule: 0 }),
  ];
  let sequence = 2;
  let encoded = 0;
  for (let at = 0; at < packets.length; at += packetsPerPage) {
    const group = packets.slice(at, at + packetsPerPage);
    for (const packet of group) {
      if (!(packet instanceof Uint8Array) || !packet.length) throw new TypeError('ogg_invalid_packet');
    }
    encoded += group.length * frameSamples;
    // La posición granular cuenta muestras descodificables más el pre-salto.
    pages.push(page({ packets: group, serial, sequence: sequence++, granule: encoded + preSkip,
      last: at + packetsPerPage >= packets.length }));
  }

  const total = pages.reduce((size, item) => size + item.length, 0);
  const file = new Uint8Array(total);
  let at = 0;
  for (const item of pages) { file.set(item, at); at += item.length; }
  return file;
}

/** Duración real del audio producido, en segundos. */
export function oggOpusSeconds(packets, frameSamples = OPUS_FRAME_SAMPLES) {
  return (packets.length * frameSamples) / OPUS_SAMPLE_RATE;
}
