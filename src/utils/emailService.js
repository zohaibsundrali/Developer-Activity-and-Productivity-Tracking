import emailjs from '@emailjs/browser';

class EmailService {
  constructor() {
    this.initialized = false;
    this.init();
  }

  init() {
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY) {
      try {
        emailjs.init(process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY);
        this.initialized = true;
        console.log('✅ EmailJS initialized successfully');
      } catch (error) {
        console.error('❌ EmailJS initialization failed:', error);
      }
    } else {
      console.warn('⚠️ EmailJS public key not found');
    }
  }

  async sendVerificationCode(email, userName, code) {
    if (!this.initialized) {
      throw new Error('EmailJS not initialized. Check your public key.');
    }

    // Validate required environment variables
    if (!process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID) {
      throw new Error('EmailJS Service ID is missing');
    }

    if (!process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID) {
      throw new Error('EmailJS Template ID is missing');
    }

    console.log('📧 Attempting to send email...', {
      serviceId: process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
      templateId: process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
      to: email
    });

    try {
      const templateParams = {
        to_email: email,
        user_name: userName,
        verification_code: code,
        code: code,
        message: code,
        from_name: 'Admin Registration System',
        reply_to: 'noreply@yourapp.com',
        subject: 'Your Verification Code'
      };

      console.log('📤 Sending with parameters:', templateParams);

      const result = await emailjs.send(
        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
        process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
        templateParams
      );

      console.log('✅ Email sent successfully:', result);
      return {
        success: true,
        message: 'Verification code sent successfully',
        result
      };

    } catch (error) {
      console.error('❌ EmailJS send error details:', {
        status: error?.status,
        text: error?.text,
        message: error?.message,
        fullError: error
      });

      // Enhanced error messages
      let userMessage = 'Failed to send verification email. ';
      
      if (error?.status === 412) {
        userMessage += 'Template parameter mismatch. Check your EmailJS template variables.';
      } else if (error?.status === 400) {
        userMessage += 'Invalid request parameters.';
      } else if (error?.status === 401) {
        userMessage += 'Unauthorized. Check your EmailJS API keys.';
      } else if (error?.status === 402) {
        userMessage += 'Payment required. Check your EmailJS account.';
      } else if (error?.status === 0) {
        userMessage += 'Network error. Check your internet connection.';
      } else {
        userMessage += 'Please try again later.';
      }

      throw new Error(userMessage);
    }
  }

  // Test EmailJS configuration
  async testConfiguration() {
    const testResults = {
      initialized: this.initialized,
      serviceId: !!process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
      templateId: !!process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
      publicKey: !!process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY
    };

    console.log('🔧 EmailJS Configuration Test:', testResults);
    return testResults;
  }
}

export const emailService = new EmailService();