import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request) {
  try {
    const { email, userName, company, code } = await request.json();

    console.log('🎯 Sending verification code:', {
      to: email,
      from: process.env.GMAIL_EMAIL,
      code: code
    });

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_EMAIL, // zohaibytautomation@gmail.com
        pass: process.env.GMAIL_APP_PASSWORD, // App password
      },
    });

    // Email options
    const mailOptions = {
      from: {
        name: 'Admin Registration System',
        address: process.env.GMAIL_EMAIL
      },
      to: email, // 👈 YAHI IMPORTANT HAI - User ki email
      subject: `Your Verification Code: ${code}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #009578; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1>Admin Registration Verification</h1>
          </div>
          
          <div style="padding: 30px; background: white;">
            <p>Hello <strong>${userName}</strong>,</p>
            
            <p>Your verification code for admin registration is:</p>
            
            <div style="background: #f4f4f4; padding: 25px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 8px; border: 2px dashed #009578;">
              ${code}
            </div>
            
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Company:</strong> ${company}</p>
              <p><strong>Email:</strong> ${email}</p>
            </div>
            
            <p style="color: #666;">
              <strong>Note:</strong> This code will expire in 10 minutes.
            </p>
          </div>
          
          <div style="background: #f4f4f4; padding: 15px; text-align: center; border-radius: 0 0 10px 10px;">
            <p style="margin: 0; color: #666; font-size: 12px;">
              If you didn't request this code, please ignore this email.
            </p>
          </div>
        </div>
      `,
    };

    // Send email
    const result = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!', {
      to: email,
      messageId: result.messageId,
      response: result.response
    });

    return NextResponse.json({
      success: true,
      message: 'Verification code sent successfully',
      to: email,
      messageId: result.messageId
    });

  } catch (error) {
    console.error('❌ Email sending failed:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to send verification code',
        details: error.message 
      },
      { status: 500 }
    );
  }
}