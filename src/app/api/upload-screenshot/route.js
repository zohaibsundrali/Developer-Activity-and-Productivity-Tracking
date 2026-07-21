import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const { developer_id, image_data, session_id, context, timestamp } = await request.json();

    // Upload to Supabase Storage
    const fileName = `screenshots/${developer_id}/${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
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

    // Save to database. Only REAL columns of the screenshots table are written:
    // public_url is the canonical URL the desktop app writes and every reader
    // displays. (image_url / thumbnail_url / activity_context / session_id do
    // NOT exist in this table's schema and previously made this insert fail.)
    const { data, error } = await supabase
      .from('screenshots')
      .insert([
        {
          developer_id,
          public_url: urlData.publicUrl,
          storage_path: fileName,
          filename: fileName.split('/').pop(),
          annotation_text: context || null,
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
    return NextResponse.json(
      { error: 'Failed to upload screenshot' },
      { status: 500 }
    );
  }
}

function base64ToBuffer(base64String) {
  return Buffer.from(base64String, 'base64');
}