// Validates the recovered Ludo King socket wire format against a live test vector.
// Format: <1-char keyId><1-char ivId> + base64(AES-128-CBC(PKCS7(JSON)))
import {createDecipheriv, createCipheriv} from 'node:crypto';

export const KEYS = {
  '0': 'ova5w2fuej87hv6b',
  '1': 'jbic95s45p7e6s30',
  '2': '7mmm6gfd5hs36b2d',
  '3': '35vcks7m7mxscikn',
  '4': 'b1dq078uo8f4xqka',
  '5': 'sgdns6bry78ymnwa',
  '6': 'qpm1pdzm9en7wjtv',
  '7': 'b6tfohtkzycdc09a',
  '8': 'dvfltftoxfyu8wwz',
  '9': 'aq580fnbnbx3vxfn',
};
export const IVS = {
  '0': '4z2oazqn2m71etzi',
  '1': 'b7jlt31dew3lszqb',
  '2': '8agu0jka1837keua',
  '3': 'jqv1bmgbm9cwhig7',
  '4': 'c90zdpqedmr49v79',
  '5': 'da5fuf33ehql15p0',
  '6': 'dhw6s5fbkhlgumq9',
  '7': '29r8hzphpsbm746t',
  '8': '7mrg45fcyqcjzeac',
  '9': '7rbe9u3fura9at3t',
};

export function decryptBlob(blob) {
  const keyId = blob[0], ivId = blob[1];
  const key = Buffer.from(KEYS[keyId], 'ascii');
  const iv = Buffer.from(IVS[ivId], 'ascii');
  const ct = Buffer.from(blob.slice(2), 'base64');
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  // .final() is required: Node buffers the last block, and it strips PKCS7 padding.
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

export function encryptBlob(obj, keyId = '2', ivId = '7') {
  const key = Buffer.from(KEYS[keyId], 'ascii');
  const iv = Buffer.from(IVS[ivId], 'ascii');
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return keyId + ivId + ct.toString('base64');
}

// Live test vector captured from the running client (fnAesEncrypt).
const VECTOR = '278MV3SVFVdoUvf0LoRj+z1YX5GAnH06oPCiGd5UbFwzrNq2TLH6Wgi0k77UJEfAZz0QytITO6q4Te0KphlLlASQ==';
const EXPECTED = {userId: 'guest-8f3a', eGameType: 'LUDO', _tableId: ''};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/ /g, '%20'))) {
  const got = decryptBlob(VECTOR);
  console.log('decrypt live vector:', JSON.stringify(got));
  if (JSON.stringify(got) !== JSON.stringify(EXPECTED)) {
    console.error('MISMATCH');
    process.exit(1);
  }
  const re = encryptBlob(got, '2', '7');
  console.log('re-encrypt:', re);
  console.log('re-decrypt:', JSON.stringify(decryptBlob(re)));
  console.log('OK');
}
