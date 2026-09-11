import { describe,it,expect } from 'vitest';
import { notificationRecipientKey,isTypedNotificationRecipient } from '../src/utils/notificationIdentity';
describe('typed realtime notification identity',()=>{
 it('does not match the colliding other profile UUID or legacy email',()=>{
  const row={recipient_keys:['admin:same'],developer_id:'same',admin_email:'shared@test.dev'};
  expect(isTypedNotificationRecipient(row,{userId:'same',userType:'developer'})).toBe(false);
  expect(isTypedNotificationRecipient(row,{userId:'same',userType:'admin'})).toBe(true);
 });
 it('matches multiple explicitly typed recipients',()=>{
  const row={recipient_keys:['admin:same','developer:same']};
  for(const userType of ['admin','developer']) expect(isTypedNotificationRecipient(row,{userId:'same',userType})).toBe(true);
 });
 it('does not infer identity from audience or untyped legacy rows',()=>{
  expect(notificationRecipientKey({userId:'same',audience:'admin'})).toBeNull();
  expect(isTypedNotificationRecipient({admin_id:'same'},{userId:'same',userType:'admin'})).toBe(false);
  expect(notificationRecipientKey({userId:'same',userType:'client'})).toBeNull();
 });
});
