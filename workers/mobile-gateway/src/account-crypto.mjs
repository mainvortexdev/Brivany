import {scrypt,createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export class AccountError extends Error {
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export function equal(left,right){const a=Buffer.from(hash(String(left))),b=Buffer.from(hash(String(right)));return timingSafeEqual(a,b);}
export function emailAddress(value){
  if(typeof value!=='string'||value.length>254)throw new AccountError('invalid_request');
  const email=value.trim().toLowerCase();
  if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email))throw new AccountError('invalid_request');
  return email;
}
export function accountKey(email,pepper){
  if(typeof pepper!=='string'||pepper.length<32)throw new AccountError('not_configured',503);
  return createHmac('sha256',pepper).update(emailAddress(email)).digest('hex');
}
function passwordInput(password,pepper){
  if(typeof password!=='string'||password.length<16||Buffer.byteLength(password)>256)throw new AccountError('invalid_credentials',401);
  return createHmac('sha256',pepper).update(password).digest('hex');
}
function derive(input,salt){return new Promise((resolve,reject)=>scrypt(input,salt,32,{N:32768,r:8,p:3,maxmem:48*1024*1024},(error,key)=>error?reject(error):resolve(key.toString('hex'))));}
export async function passwordRecord(password,pepper){const salt=randomBytes(16).toString('hex');return {scheme:'scrypt-32768-8-3',salt,digest:await derive(passwordInput(password,pepper),salt)};}
export async function passwordMatches(password,pepper,record){
  const input=passwordInput(password,pepper);
  const candidate=await derive(input,record?.salt||'00000000000000000000000000000000');
  return record?.scheme==='scrypt-32768-8-3'&&equal(candidate,record.digest);
}
export function sessionParts(token){
  if(typeof token!=='string'||token.length>300)return null;
  const parts=token.split('.');
  return parts.length===4&&parts[0]==='b1'&&/^[a-f0-9]{64}$/.test(parts[1])&&uuid(parts[2])&&/^[A-Za-z0-9_-]{43}$/.test(parts[3])?{account:parts[1],id:parts[2],secret:parts[3]}:null;
}
