const bytesEqual = (a, b) =>
    a.length === b.length && a.every((v, i) => v === b[i]);


export const bytesToHex = bytes =>
    [...bytes].map(b => b.toString().padStart(2, '0')).join('');

export const byteToBooleansLSBFirst = byte => {
    if (byte < 0 || byte > 255)
        throw new RangeError('Input must be a 1‑byte integer (0–255)');
    const bits = new Array(8);
    for (let i = 0; i < 8; i++) bits[i] = Boolean((byte >> i) & 1);
    return bits;
};

/* encoding detection (identical logic) */
export const alphaBits = d =>
    (d & 0xc0) === 0
        ? (d & 0x0c) === 8
            ? 16
            : (d & 0x0c) === 4
                ? 8
                : 7
        : (d & 0xc0) === 0xc0
            ? (d & 0x30) === 0x20
                ? 16
                : (d & 0x30) === 0x30
                    ? 8
                    : 7
            : 7;

const _bcdNibbleToChar = n =>
    n <= 9
        ? String(n)
        : ['*', '#', 'A', 'B', 'C', 'F'][n - 10] /* 0xF = filler */;

export const semiPhone = bcd => {
    const digits = [];
    for (const byte of bcd) {
        digits.push(byte & 0x0f, (byte >> 4) & 0x0f);
    }
    let s = digits.map(_bcdNibbleToChar).join('');
    return s.endsWith('F') ? s.slice(0, -1) : s;
};

const swapNibbles = byte => ((byte & 0x0f) << 4) | (byte >> 4);
const bcdByteToNumber = b =>
    ((b >> 4) & 0x0F) * 10 + (b & 0x0F);   // 0x21 → 12

export const tzDecode = tzByte => {
    const high = (tzByte >> 4) & 0x0F;      // tens digit + sign
    const low  = tzByte & 0x0F;             // units digit
    const sign = (high & 0x8) ? '-' : '+';  // bit 3 set ⇒ negative
    const qh   = (high & 0x7) * 10 + low;   // quarter-hours (BCD)
    const hh   = String(Math.floor(qh / 4)).padStart(2, '0');
    const mm   = String((qh % 4) * 15).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
};

export const decodeTimestamp = bytes7 => {
    if (bytes7.every(b => b === 0)) return undefined;

    const s = bytes7.map(b => ((b & 0x0F) << 4) | (b >> 4)); // swap nibbles once

    const [yy, mo, dd, hh, mi, ss] = s.slice(0, 6).map(bcdByteToNumber);
    return `20${String(yy).padStart(2,'0')}-${String(mo).padStart(2,'0')}-${String(dd).padStart(2,'0')} ` +
        `${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(ss).padStart(2,'0')} ` +
        tzDecode(s[6]);
};

const DEF = [
    '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', '\n', 'Ø', 'ø', '\r', 'Å', 'å',
    '\u0081', '_', '\u0082', '\u0083', '\u0084', '\u0085', '\u0086', '\u0087',
    '\u0088', '\u0089', '\u008a', '\u001b', 'Æ', 'æ', 'ß', 'É',
    ' ', '!', '"', '#', '¤', '%', '&', "'", '(', ')', '*', '+',
    ',', '-', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', ':', ';', '<', '=', '>', '?', '¡', 'A', 'B', 'C', 'D',
    'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö',
    'Ñ', 'Ü', '§', '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
    'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
    'u', 'v', 'w', 'x', 'y', 'z', 'ä'
];
const EXT = new Map([
    [0x0A, '\f'], [0x14, '^'], [0x28, '{'], [0x29, '}'],
    [0x2F, '\\'], [0x3C, '['], [0x3D, '~'], [0x3E, ']'],
    [0x40, '|'], [0x65, '€']
]);

export const sevenBitDecode = (bytes, skip, septets) => {
    let out = '',
        esc = false,
        bitPos = 0;

    for (let i = 0; i < septets; i++) {
        const bytePos = Math.floor(bitPos / 8);
        const b1 = bytes[bytePos] ?? 0;
        const b2 = bytes[bytePos + 1] ?? 0;
        const v = ((b1 >> (bitPos % 8)) | (b2 << (8 - (bitPos % 8)))) & 0x7f;
        bitPos += 7;
        if (i < skip) continue;

        if (esc) {
            out += EXT.get(v) || '�';
            esc = false;
        } else if (v === 0x1b) esc = true;
        else out += DEF[v] ?? '�';
    }
    return out;
};

export const ucs2Decode = (bytes, skipOct) =>
    new TextDecoder('utf-16be').decode(bytes.subarray(skipOct));

export const octetDecode = (bytes, skipOct) =>
    String.fromCharCode(...bytes.subarray(skipOct));

/* Remove trailing 0xFF */
const trimTrailingFFs = buf => {
    let end = buf.length;
    while (end >= 1 && buf[end - 1] === 0xff) end--;
    return buf.subarray(0, end);
};

class ByteCursor {
    constructor(bytes) {
        this.b = bytes;
        this.i = 0;
    }
    take(n) {
        if (this.i + n > this.b.length)
            throw new RangeError('Attempt to read past end of buffer');
        const s = this.b.subarray(this.i, this.i + n);
        this.i += n;
        return s;
    }
    takeByte() {
        if (this.i >= this.b.length)
            throw new RangeError('Attempt to read past end of buffer');
        return this.b[this.i++];
    }
    peek(n) {
        return this.b.subarray(this.i, this.i + n);
    }
    remaining() {
        return this.b.length - this.i;
    }
}

export class PDUDecoder {
    #cursor;

    decode(u8) {
        const buf = trimTrailingFFs(
            u8 instanceof Uint8Array ? u8 : Uint8Array.from(u8)
        );
        if (buf.length < 2) return undefined;

        this.#cursor = new ByteCursor(buf);

        const smsCenterLength = this.#cursor.takeByte();
        const smsCenterType = this.#cursor.takeByte();
        const smsCenterNumber =
            smsCenterLength > 1 ? semiPhone(this.#cursor.take(smsCenterLength - 1)) : '';

        const firstOctet = this.#cursor.peek(1)[0];
        const messageType = firstOctet & 3;
        if (messageType === 2) return this.#statusReport(smsCenterType, smsCenterNumber);

        const decodedPdu = this.#decodePduFromFirstOctet(firstOctet);

        return {
            ...decodedPdu,
            smsCenterType,
            smsCenterNumber,
            format: 'SMS.dat'
        };
    }

    decodeSmsDat(u8) {
        const folderFlag = u8[0]; //01 = inbox read, 03 = inbox unread, 05 = outbox sent, 07 = outbox unsent
        return this.decode(u8.subarray(1));
    }

    /* ‑‑‑‑‑‑ internal helpers ‑‑‑‑‑‑ */
    #statusReport(scaType, scaNumber) {
        const mr = this.#cursor.takeByte();
        const recipientLen = this.#cursor.takeByte();
        this.#cursor.takeByte(); // TOA
        const recipient = semiPhone(this.#cursor.take(Math.ceil(recipientLen / 2)));
        const ts = decodeTimestamp(this.#cursor.take(7));
        const dischargeTs = decodeTimestamp(this.#cursor.take(7));
        const status = this.#cursor.takeByte();

        return {
            type: 'STATUS_REPORT',
            smsCenterType: scaType,
            smsCenterNumber: scaNumber,
            messageRef: mr,
            recipient,
            timestamp: ts,
            dischargeTs,
            status
        };
    }

    #decodePduFromFirstOctet(firstOctet) {
        this.#cursor.take(1); // consume FO
        const firstOctetBits = byteToBooleansLSBFirst(firstOctet);
        const isSubmit = firstOctetBits[0];
        const isCommandOrStatusReport = firstOctetBits[1];
        const rejectDuplicatesOrMoreMessagesToSend = firstOctetBits[2];
        const loopPrevention = firstOctetBits[3];
        const validityPeriodFormat = firstOctetBits[3];
        const validityPeriodFollowsInSubmit = firstOctetBits[4];
        const statusReportStatus = firstOctetBits[5];
        const udhiPresent = firstOctetBits[6];
        const replyPath = firstOctetBits[7];

        /**
         * The Message Reference field (TP-MR) is used in all messages on the submission side with exception of
         * the SMS-SUBMIT-REPORT (that is in SMS-SUBMIT, SMS-COMMAND and SMS-STATUS-REPORT).
         * It is a single-octet value which is incremented each time a new message is submitted or a new SMS-COMMAND is sent.
         * If the message submission fails, the mobile phone should repeat the submission with the same TP-MR value and
         * with the TP-RD bit set to 1.
         */
        let messageRef;
        if (isSubmit) messageRef = this.#cursor.takeByte();

        const addrLen = this.#cursor.takeByte();
        const addrToa = this.#cursor.takeByte();
        const addrRaw = this.#cursor.take(Math.ceil(addrLen / 2));
        const isAlpha = (addrToa & 0x70) === 0x50;
        const phone = isAlpha
            ? sevenBitDecode(addrRaw, 0, addrLen)
            : semiPhone(addrRaw);

        const pid = this.#cursor.takeByte();
        const dcs = this.#cursor.takeByte();
        const bitsPerChar = alphaBits(dcs);

        let timestamp;
        if (isSubmit) {
            if (validityPeriodFollowsInSubmit) this.#cursor.takeByte(); // skip VP
        } else {
            timestamp = decodeTimestamp(this.#cursor.take(7));
        }

        const udl = this.#cursor.takeByte();
        const udBody = this.#cursor.take(this.#cursor.remaining()); // rest of buffer

        const { udh, encoding, text, length } = this.#decodeUserData(
            udBody,
            udhiPresent,
            bitsPerChar,
            udl
        );

        const common = {
            firstOctet,
            udhiPresent,
            pid,
            dcs,
            classDesc: dcs & 0x10 ? `class ${(dcs & 3)}` : '',
            udh,
            length,
            text,
            encoding
        };

        return isSubmit
            ? { ...common, type: 'Outgoing', recipient: phone, messageRef }
            : { ...common, type: 'Incoming', sender: phone, timestamp };
    }

    #decodeUserData(body, udhiPresent, bitsPerChar, udl) {
        let skipOct = 0;
        let udhBytes = new Uint8Array(0);

        if (udhiPresent) {
            const udhl = body[0];
            udhBytes = body.subarray(0, udhl + 1);
            skipOct = udhl + 1;
        }

        let encoding, text;
        switch (bitsPerChar) {
            case 16:
                encoding = 'UCS-2';
                text = ucs2Decode(body, skipOct);
                break;
            case 8:
                encoding = 'ASCII';
                text = octetDecode(body, skipOct);
                break;
            case 7:
                encoding = 'GSM-7';
                text = sevenBitDecode(body, Math.ceil(skipOct * 8 / 7), udl);
                break;
            default:
                throw new Error(`Unknown number of bits: ${bitsPerChar}`);
        }

        const length =
            bitsPerChar === 16 ? (body.length - skipOct) / 2 : udl - skipOct;

        return { udh: bytesToHex(udhBytes), encoding, text, length };
    }
}

const FileFormats = Object.freeze({
    SL4x: {
        signature:  Uint8Array.from([0x0b, 0x0b, 0x00, 0x00, 0x00]),
        segmentStatusOffset: 5,
        smsCOffset: 6
    },
    X55_ME45: {
        signature:  Uint8Array.from([0x0b, 0x0b, 0x01, 0x01, 0x00]),
        smsPartsOffset: 5,
        smsTypeOffset: 7,
        smsStatusOffset: 8,
        timestampOffset: 9,
        segmentStatusOffset: 16,
        smsCOffset: 17
    },
    X55_X65_X75: {
        signature:  Uint8Array.from([0x0b, 0x0b, 0x02, 0x0c, 0x00]),
        smsPartsOffset: 5,
        smsTypeOffset: 7,
        smsStatusOffset: 8,
        timestampOffset: 9,
        segmentStatusOffset: 17,
        smsCOffset: 18
    }
});

export class SMSDecoder {
    decode(buf) {
        const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
        if (b.length <= 5) throw new Error('File too short');

        let cursor = new ByteCursor(b);

        const signature = cursor.take(5);
        let formatName;
        for (const [entryFormatName, formatEntry] of Object.entries(FileFormats)) {
            if (bytesEqual(signature, formatEntry.signature)) {
                formatName = entryFormatName;
                break;
            }
        }
        if (formatName === undefined)
            throw new Error(
                `Unknown file format. First 5 bytes: ${bytesToHex(signature)}`
            );

        const format = FileFormats[formatName];

        const smsPartsTotal = format.smsPartsOffset ? cursor.takeByte() : 0;
        const smsPartsStored = format.smsPartsOffset ? cursor.takeByte() : 0;
        const smsType = format.smsTypeOffset ? cursor.takeByte() : undefined;
        const smsStatus = format.smsStatusOffset ? cursor.takeByte() : undefined;
        const timestamp = format.timestampOffset
            ? decodeTimestamp(cursor.take(7))
            : undefined;

        if (format.segmentStatusOffset - format.timestampOffset > 7)
            cursor.take(format.segmentStatusOffset - format.timestampOffset - 7); // waste byte

        let parsingResult;
        for (let part = 0; part < smsPartsTotal; part++) {
            if (cursor.remaining() < 176)
                console.warn(`Segment ${part + 1} incomplete – decoding anyway`);
            let pdu = cursor.take(176);

            if (format.segmentStatusOffset) {
                // first byte is segment status – strip it
                pdu = pdu.subarray(1);
            }

            const decodedPdu = new PDUDecoder().decode(pdu);
            if (decodedPdu === undefined) continue;

            if (parsingResult === undefined) {
                parsingResult = {
                    ...decodedPdu,
                    format,
                    smsPartsTotal,
                    smsPartsStored
                };
                if (timestamp !== undefined) parsingResult.timestamp = timestamp;
                if (smsType !== undefined) parsingResult.smsType = smsType;
                if (smsStatus !== undefined) parsingResult.smsStatus = smsStatus;
            } else {
                parsingResult.text += decodedPdu.text;
                parsingResult.length += decodedPdu.length;
            }
        }
        return parsingResult;
    }
}

export class SMSDatParser {
    decode(buf) {
        const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
        if (b.length <= 178) throw new Error('File too short');

        let cursor = new ByteCursor(b);
        const NSG_EMPTY =  Uint8Array.from([0xff, 0xff]);
        const EXPECTED_HEADER =  Uint8Array.from([0x11, 0x11]);

        const messages = [];
        while (cursor.remaining() >= 2) {
            const hdr = cursor.take(2);
            if (bytesEqual(hdr, NSG_EMPTY)) continue;
            if (!bytesEqual(hdr, EXPECTED_HEADER))
                throw new Error(`Invalid PDU header: ${bytesToHex(hdr)}`);

            if (cursor.remaining() < 176) {
                console.warn('Incomplete PDU record in SMS.dat, attempting a partial read');
            }
            const pdu = cursor.take(176);
            const decodedPdu = new PDUDecoder().decodeSmsDat(pdu);
            if (decodedPdu !== undefined) messages.push(decodedPdu);
        }
        return messages;
    }
}
