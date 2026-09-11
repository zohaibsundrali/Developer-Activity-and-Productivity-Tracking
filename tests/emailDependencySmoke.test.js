import { expect, it } from 'vitest';
import nodemailer from 'nodemailer';

// Exercise the upgraded provider API without credentials, network, or delivery.
it('composes the application SMTP message shape with the patched Nodemailer release', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const result = await transport.sendMail({
    from: 'Workspace <sender@example.test>', to: 'client@example.test',
    subject: 'Project proposal update', text: 'Your proposal was accepted.',
    html: '<p>Your proposal was accepted.</p>',
  });
  expect(result.envelope.to).toEqual(['client@example.test']);
  const message = result.message.toString('utf8');
  expect(message).toContain('Subject: Project proposal update');
  expect(message).toContain('Your proposal was accepted.');
  transport.close();
});
