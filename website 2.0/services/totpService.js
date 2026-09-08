const crypto = require('crypto');
const QRCode = require('qrcode');

// Base32 standard alphabet
const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const cleanInput = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const idx = RFC4648_ALPHABET.indexOf(cleanInput[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

const totpService = {
  // Generate random 16-byte Base32 secret for Google Authenticator
  generateSecret: () => {
    const randomBytes = crypto.randomBytes(20);
    return base32Encode(randomBytes);
  },

  // Calculate current or specified counter 6-digit code
  generateToken: (secret, timeOffset = 0) => {
    try {
      const key = base32Decode(secret);
      const epoch = Math.floor(Date.now() / 1000) + timeOffset;
      const counter = Math.floor(epoch / 30);

      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64BE(BigInt(counter));

      const hmac = crypto.createHmac('sha1', key);
      hmac.update(buffer);
      const digest = hmac.digest();

      const offset = digest[digest.length - 1] & 0xf;
      const binary =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);

      const otp = binary % 1000000;
      return String(otp).padStart(6, '0');
    } catch (e) {
      console.error("[TOTP] Generation error:", e.message);
      return null;
    }
  },

  // Verify TOTP allowing 1 step drift (+/- 30 seconds)
  verifyToken: (secret, token) => {
    if (!token || !secret) return false;
    const cleanToken = String(token).trim();
    if (cleanToken.length !== 6) return false;

    // Check t-1, t, and t+1 windows
    const windows = [-30, 0, 30];
    for (const offset of windows) {
      const generated = totpService.generateToken(secret, offset);
      if (generated === cleanToken) {
        return true;
      }
    }
    return false;
  },

  // Generate QR Code data URL for Google Authenticator app
  generateQrCode: async (email, secret, issuer = 'PulseGrab Ecosystem') => {
    const label = encodeURIComponent(`${issuer}:${email}`);
    const otpAuthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    try {
      const qrDataUrl = await QRCode.toDataURL(otpAuthUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      return { otpAuthUrl, qrDataUrl };
    } catch (err) {
      console.error("[TOTP] QR code generation error:", err);
      return { otpAuthUrl, qrDataUrl: null };
    }
  }
};

module.exports = totpService;
