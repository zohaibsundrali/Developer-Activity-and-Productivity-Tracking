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
      } catch (error) {
        // EmailJS initialization failed
      }
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

      const result = await emailjs.send(
        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
        process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
        templateParams
      );

      return {
        success: true,
        message: 'Verification code sent successfully',
        result
      };

    } catch (error) {

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

    return testResults;
  }
}

export const emailService = new EmailService();