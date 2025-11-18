import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request) {
  try {
    const { email, userName, company, code, type = "login", role = "user" } = await request.json();

    console.log('🎯 Sending verification code:', {
      to: email,
      from: process.env.GMAIL_EMAIL,
      code: code,
      type: type,
      role: role
    });

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_EMAIL, // zohaibytautomation@gmail.com
        pass: process.env.GMAIL_APP_PASSWORD, // App password
      },
    });

    // Determine email subject and content based on type
    const getEmailContent = () => {
      if (type === "login") {
        return {
          subject: `Login Verification Code: ${code}`,
          title: `${role.charAt(0).toUpperCase() + role.slice(1)} Login Verification`,
          greeting: `Hello <strong>${userName}</strong>,`,
          message: `Your verification code for ${role} login is:`
        };
      } else {
        return {
          subject: `Admin Registration Verification Code: ${code}`,
          title: 'Admin Registration Verification',
          greeting: `Hello <strong>${userName}</strong>,`,
          message: 'Your verification code for admin registration is:'
        };
      }
    };

    const emailContent = getEmailContent();

    // Email options
    const mailOptions = {
      from: {
        name: 'Developer Activity Tracking System',
        address: process.env.GMAIL_EMAIL
      },
      to: email,
      subject: emailContent.subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #009578; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1>${emailContent.title}</h1>
          </div>
          
          <div style="padding: 30px; background: white;">
            <p>${emailContent.greeting}</p>
            
            <p>${emailContent.message}</p>
            
            <div style="background: #f4f4f4; padding: 25px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 8px; border: 2px dashed #009578;">
              ${code}
            </div>
            
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Name:</strong> ${userName}</p>
              <p><strong>Company:</strong> ${company}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Role:</strong> ${role.charAt(0).toUpperCase() + role.slice(1)}</p>
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