'use strict';

const crypto = require('crypto');
const md4 = require('js-md4');

function createLMResponse(challenge, lmhash) {
	let buf = new Buffer(24),
		pwBuffer = new Buffer(21).fill(0);

	lmhash.copy(pwBuffer);

	calculateDES(pwBuffer.slice(0, 7), challenge).copy(buf);
	calculateDES(pwBuffer.slice(7, 14), challenge).copy(buf, 8);
	calculateDES(pwBuffer.slice(14), challenge).copy(buf, 16);

	return buf;
}

function createLMHash(password) {
	let buf = new Buffer(16),
		pwBuffer = new Buffer(14),
		magicKey = new Buffer('KGS!@#$%', 'ascii');

	if (password.length > 14) {
		buf.fill(0);
		return buf;
	}

	pwBuffer.fill(0);
	pwBuffer.write(password.toUpperCase(), 0, 'ascii');

	return Buffer.concat([
			calculateDES(pwBuffer.slice(0, 7), magicKey),
			calculateDES(pwBuffer.slice(7), magicKey)
	]);
}

function calculateDES(key, message) {
	let desKey = new Buffer(8);

	desKey[0] = key[0] & 0xFE;
	desKey[1] = ((key[0] << 7) & 0xFF) | (key[1] >> 1);
	desKey[2] = ((key[1] << 6) & 0xFF) | (key[2] >> 2);
	desKey[3] = ((key[2] << 5) & 0xFF) | (key[3] >> 3);
	desKey[4] = ((key[3] << 4) & 0xFF) | (key[4] >> 4);
	desKey[5] = ((key[4] << 3) & 0xFF) | (key[5] >> 5);
	desKey[6] = ((key[5] << 2) & 0xFF) | (key[6] >> 6);
	desKey[7] = (key[6] << 1) & 0xFF;

	for (let i = 0; i < 8; i++) {
		let parity = 0;

		for (let j = 1; j < 8; j++) {
			parity += (desKey[i] >> j) % 2;
		}

		desKey[i] |= (parity % 2) === 0 ? 1 : 0;
	}

	let des = crypto.createCipheriv('DES-ECB', desKey, '');
	return des.update(message);
}

function createNTLMResponse(challenge, ntlmhash) {
	let buf = new Buffer(24),
		ntlmBuffer = new Buffer(21).fill(0);

	ntlmhash.copy(ntlmBuffer);

	calculateDES(ntlmBuffer.slice(0, 7), challenge).copy(buf);
	calculateDES(ntlmBuffer.slice(7, 14), challenge).copy(buf, 8);
	calculateDES(ntlmBuffer.slice(14), challenge).copy(buf, 16);

	return buf;
}

function createNTLMHash(password) {
	let md4sum = md4.create();
	md4sum.update(new Buffer(password, 'ucs2'));
	return Buffer.from(md4sum.digest());
}

function createNTLMv2Hash(ntlmhash, username, authTargetName) {
	let hmac = crypto.createHmac('md5', ntlmhash);
	hmac.update(new Buffer(username.toUpperCase() + authTargetName, 'ucs2'));
	return hmac.digest();
}

function createLMv2Response(type2message, username, ntlmhash, nonce, targetName) {
	let buf = new Buffer(24),
		ntlm2hash = createNTLMv2Hash(ntlmhash, username, targetName),
		hmac = crypto.createHmac('md5', ntlm2hash);

	//server challenge
	type2message.challenge.copy(buf, 8);

	//client nonce
	buf.write(nonce || createPseudoRandomValue(16), 16, 'hex');

	//create hash
	hmac.update(buf.slice(8));
	let hashedBuffer = hmac.digest();

	hashedBuffer.copy(buf);

	return buf;
}

function createNTLMv2Response(type2message, username, ntlmhash, nonce, targetName) {
	let buf = new Buffer(48 + type2message.targetInfo.buffer.length),
		ntlm2hash = createNTLMv2Hash(ntlmhash, username, targetName),
		hmac = crypto.createHmac('md5', ntlm2hash);

	//the first 8 bytes are spare to store the hashed value before the blob

	//server challenge
	type2message.challenge.copy(buf, 8);

	//blob signature
	buf.writeUInt32BE(0x01010000, 16);

	//reserved
	buf.writeUInt32LE(0, 20);

	//timestamp
	//TODO: we are loosing precision here since js is not able to handle those large integers
	// maybe think about a different solution here
	// 11644473600000 = diff between 1970 and 1601
	let timestamp = ((Date.now() + 11644473600000) * 10000).toString(16);
	let timestampLow = Number('0x' + timestamp.substring(Math.max(0, timestamp.length - 8)));
	let timestampHigh = Number('0x' + timestamp.substring(0, Math.max(0, timestamp.length - 8)));

	buf.writeUInt32LE(timestampLow, 24, false);
	buf.writeUInt32LE(timestampHigh, 28, false);

	//random client nonce
	buf.write(nonce || createPseudoRandomValue(16), 32, 'hex');

	//zero
	buf.writeUInt32LE(0, 40);

	//complete target information block from type 2 message
	type2message.targetInfo.buffer.copy(buf, 44);

	//zero
	buf.writeUInt32LE(0, 44 + type2message.targetInfo.buffer.length);

	hmac.update(buf.slice(8));
	let hashedBuffer = hmac.digest();

	hashedBuffer.copy(buf);

	return {ntlmv2:buf,key:hashedBuffer};
}

function createPseudoRandomValue(length) {
	let str = '';
	while (str.length < length) {
		str += Math.floor(Math.random() * 16).toString(16);
	}
	return str;
}

module.exports = {
	createLMHash,
	createNTLMHash,
	createLMResponse,
	createNTLMResponse,
	createLMv2Response,
	createNTLMv2Response,
	createPseudoRandomValue
};