import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const { developer_id, image_data, session_id, context, timestamp } = await request.json();

    // Upload to Supabase Storage
    const fileName = `screenshots/${developer_id}/${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, base64ToBuffer(image_data), {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(fileName);

    // Save to database
    const { data, error } = await supabase
      .from('screenshots')
      .insert([
        {
          developer_id,
          image_url: urlData.publicUrl,
          thumbnail_url: urlData.publicUrl,
          activity_context: context,
          session_id,
          timestamp: new Date(timestamp).toISOString()
        }
      ])
      .select();

    if (error) throw error;

    // Also record as activity
    await supabase
      .from('developer_activities')
      .insert([
        {
          developer_id,
          activity_type: 'screenshot',
          activity_data: {
            context: context,
            image_url: urlData.publicUrl
          },
          session_id,
          productivity_score: 0.7,
          timestamp: new Date(timestamp).toISOString()
        }
      ]);

    return NextResponse.json({ 
      success: true, 
      message: 'Screenshot uploaded successfully',
      url: urlData.publicUrl 
    });

  } catch (error) {
    console.error('Error uploading screenshot:', error);
    return NextResponse.json(
      { error: 'Failed to upload screenshot' },
      { status: 500 }
    );
  }
}

function base64ToBuffer(base64String) {
  return Buffer.from(base64String, 'base64');
}