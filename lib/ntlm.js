/* eslint-disable no-unused-vars */
'use strict';

const os = require('os');
	const flags = require('./flags');
	const hash = require('./hash');

const NTLMSIGNATURE = "NTLMSSP\0";

function encodeType1(workstation, target) {
	let dataPos = 32;
		let pos = 0;
		let buf = new Buffer(1024);

	workstation = workstation === undefined ? os.hostname() : workstation;
	target =  target === undefined ? '' : target;

	// signature
	buf.write(NTLMSIGNATURE, pos, NTLMSIGNATURE.length, 'ascii');
	pos += NTLMSIGNATURE.length;

	// message type
	buf.writeUInt32LE(1, pos);
	pos += 4;

	// flags
	buf.writeUInt32LE(flags.NTLMFLAG_NEGOTIATE_OEM |
						flags.NTLMFLAG_REQUEST_TARGET |
						flags.NTLMFLAG_NEGOTIATE_NTLM_KEY |
						flags.NTLMFLAG_NEGOTIATE_NTLM2_KEY |
						flags.NTLMFLAG_NEGOTIATE_ALWAYS_SIGN, pos);
	pos += 4;

	// domain security buffer
	buf.writeUInt16LE(target.length, pos);
	pos += 2;
	buf.writeUInt16LE(target.length, pos);
	pos += 2;
	buf.writeUInt32LE(target.length === 0 ? 0 : dataPos, pos);
	pos += 4;

	if (target.length > 0) {
		dataPos += buf.write(target, dataPos, 'ascii');
	}

	// workstation security buffer
	buf.writeUInt16LE(workstation.length, pos);
	pos += 2;
	buf.writeUInt16LE(workstation.length, pos);
	pos += 2;
	buf.writeUInt32LE(workstation.length === 0 ? 0 : dataPos, pos);
	pos += 4;

	if (workstation.length > 0) {
		dataPos += buf.write(workstation, dataPos, 'ascii');
	}
  
	return buf.slice(0,dataPos)
}
function createType1Message(workstation, target) {
	return 'NTLM ' + encodeType1(workstation, target).toString('base64');	
}

function decodeType2(buf) {
	if (!buf) {
		throw new Error('Invalid argument');
	}

	let obj = {};

	// check message type
	if (buf.readUInt32LE(NTLMSIGNATURE.length) !== 2) {
		throw new Error('Invalid message type (no type 2)');
	}

	// read flags
	obj.flags = buf.readUInt32LE(20);

	obj.encoding = (obj.flags & flags.NTLMFLAG_NEGOTIATE_OEM) ? 'ascii' : 'ucs2';

	obj.version = (obj.flags & flags.NTLMFLAG_NEGOTIATE_NTLM2_KEY) ? 2 : 1;

	obj.challenge = buf.slice(24, 32);

	// read target name
	obj.targetName = (function(){
		let length = buf.readUInt16LE(12);
		// skipping allocated space
		let offset = buf.readUInt32LE(16);

		if (length === 0) {
			return '';
		}

		if ((offset + length) > buf.length || offset < 32) {
			throw new Error('Bad type 2 message');
		}

		return buf.toString(obj.encoding, offset, offset + length);
	})();

	// read target info
	if (obj.flags & flags.NTLMFLAG_NEGOTIATE_TARGET_INFO) {
		obj.targetInfo = (function(){
			let info = {};

			let length = buf.readUInt16LE(40);
			// skipping allocated space
			let offset = buf.readUInt32LE(44);

			let targetInfoBuffer = new Buffer(length);
			buf.copy(targetInfoBuffer, 0, offset, offset + length);

			if (length === 0) {
				return info;
			}

			if ((offset + length) > buf.length || offset < 32) {
				throw new Error('Bad type 2 message');
			}

			let pos = offset;

			while (pos < (offset + length)) {
				let blockType = buf.readUInt16LE(pos);
				pos += 2;
				let blockLength = buf.readUInt16LE(pos);
				pos += 2;

				if (blockType === 0) {
					// reached the terminator subblock
					break;
				}

				let blockTypeStr;

				switch (blockType) {
					case 1:
						blockTypeStr = 'SERVER';
						break;
					case 2:
						blockTypeStr = 'DOMAIN';
						break;
					case 3:
						blockTypeStr = 'FQDN';
						break;
					case 4:
						blockTypeStr = 'DNS';
						break;
					case 5:
						blockTypeStr = 'PARENT_DNS';
						break;
					default:
						blockTypeStr = '';
						break;
				}

				if (blockTypeStr) {
					info[blockTypeStr] = buf.toString('ucs2', pos, pos + blockLength);
				}

				pos += blockLength;
			}

			return {
				parsed: info,
				buffer: targetInfoBuffer
			};
		})();
	}
	return obj;
}
function decodeType2Message(str) {
	if (str === undefined) {
		throw new Error('Invalid argument');
	}

	//convenience
	if (Object.prototype.toString.call(str) !== '[object String]') {
		if (str.hasOwnProperty('headers') && str.headers.hasOwnProperty('www-authenticate')) {
			str = str.headers['www-authenticate'];
		} else {
			throw new Error('Invalid argument');
		}
	}

	let ntlmMatch = /^NTLM ([^,\s]+)/.exec(str);

	if (ntlmMatch) {
		str = ntlmMatch[1];
	}

	return decodeType2(new Buffer(str, 'base64'))
}
function encodeType3(type2Message, username, password, workstation, target) {
	let dataPos = 52;
		let buf = new Buffer(1024);

	if (workstation === undefined) {
		workstation = ''; //os.hostname();
	}

	if (target === undefined) {
		target = '';// type2Message.targetName;
	}

	// signature
	buf.write(NTLMSIGNATURE, 0, NTLMSIGNATURE.length, 'ascii');

	// message type
	buf.writeUInt32LE(3, 8);
	let key = null
	if (type2Message.version === 2) {
		dataPos = 64;

		let ntlmHash = hash.createNTLMHash(password);
			let nonce = hash.createPseudoRandomValue(16);
			let lmv2 = hash.createLMv2Response(type2Message, username, ntlmHash, nonce, target);
			let obj = hash.createNTLMv2Response(type2Message, username, ntlmHash, nonce, target);
			let ntlmv2=obj.ntlmv2;
			key=obj.key
		// lmv2 security buffer
		buf.writeUInt16LE(lmv2.length, 12);
		buf.writeUInt16LE(lmv2.length, 14);
		buf.writeUInt32LE(dataPos, 16);

		lmv2.copy(buf, dataPos);
		dataPos += lmv2.length;
		
		// ntlmv2 security buffer
		buf.writeUInt16LE(ntlmv2.length, 20);
		buf.writeUInt16LE(ntlmv2.length, 22);
		buf.writeUInt32LE(dataPos, 24);

		ntlmv2.copy(buf, dataPos);
		dataPos += ntlmv2.length;
	} else {
		let lmHash = hash.createLMHash(password);
			let ntlmHash = hash.createNTLMHash(password);
			let lm = hash.createLMResponse(type2Message.challenge, lmHash);
			let ntlm = hash.createNTLMResponse(type2Message.challenge, ntlmHash);

		// lm security buffer
		buf.writeUInt16LE(lm.length, 12);
		buf.writeUInt16LE(lm.length, 14);
		buf.writeUInt32LE(dataPos, 16);

		lm.copy(buf, dataPos);
		dataPos += lm.length;

		// ntlm security buffer
		buf.writeUInt16LE(ntlm.length, 20);
		buf.writeUInt16LE(ntlm.length, 22);
		buf.writeUInt32LE(dataPos, 24);

		ntlm.copy(buf, dataPos);
		dataPos += ntlm.length;
	}

	// target name security buffer
	buf.writeUInt16LE(type2Message.encoding === 'ascii' ? target.length : target.length * 2, 28);
	buf.writeUInt16LE(type2Message.encoding === 'ascii' ? target.length : target.length * 2, 30);
	buf.writeUInt32LE(dataPos, 32);

	dataPos += buf.write(target, dataPos, type2Message.encoding);

	// user name security buffer
	buf.writeUInt16LE(type2Message.encoding === 'ascii' ? username.length : username.length * 2, 36);
	buf.writeUInt16LE(type2Message.encoding === 'ascii' ? username.length : username.length * 2, 38);
	buf.writeUInt32LE(dataPos, 40);

	dataPos += buf.write(username, dataPos, type2Message.encoding);

	// workstation name security buffer
	buf.writeUInt16LE(type2Message.encoding === 'ascii' ? workstation.length : workstation.length * 2, 44);
	buf.writeUInt16LE(type2Message.encoding === 'ascii' ? workstation.length : workstation.length * 2, 46);
	buf.writeUInt32LE(dataPos, 48);

	dataPos += buf.write(workstation, dataPos, type2Message.encoding);

	if (type2Message.version === 2) {
		const keyLength=key.byteLength
		buf.writeUInt16LE(keyLength, 52);
		buf.writeUInt16LE(keyLength, 54);
		buf.writeUInt32LE(dataPos, 56);

		// console.log(' session key:',key,',length:',key.byteLength)
		key.copy(buf, dataPos);
		dataPos += key.length;

		// flags
		buf.writeUInt32LE(type2Message.flags, 60);
	}
	return buf.slice(0,dataPos)
}

function createType3Message(workstation, target) {
	return 'NTLM ' + encodeType1(workstation, target).toString('base64');	
}

module.exports = {
	encodeType1,
	createType1Message,
	decodeType2,
	decodeType2Message,
	encodeType3,
	createType3Message
};