import { team_control } from './team.js';
import { socialGreeting } from './conversation.js';
import { literalNote } from './memory.js';
import { requestDesktopLink } from './desktop.js';
import { continueDesktopLink } from './desktop.js';
import { continueStoryPortrait } from './social.js';
import { continueAudio } from './creative.js';
import { continueImageEdit } from './creative.js';
import { readStagedImage } from './creative.js';
import { editStagedImage } from './creative.js';
import { continueDocumentTemplate, continueDocumentDelivery } from './documents.js';
import { continueReminderAttachment } from './calendar.js';
import { stageImage } from './memory.js';
import { cancel } from './conversation.js';
import { story_portrait } from './social.js';
import { story_visual_reference_save } from './social.js';
import { story_visual_reference_stop } from './social.js';
import { story_auto_on } from './social.js';
import { story_single_create } from './social.js';
import { story_campaign_start } from './social.js';
import { story_campaign_pause } from './social.js';
import { story_campaign_status } from './social.js';
import { marketing_review } from './research.js';
import { project_update } from './projects.js';
import { project_list } from './projects.js';
import { project_query } from './projects.js';
import { edit_image } from './creative.js';
import { instagram_operation } from './social.js';
import { continueEmailDelivery } from './email.js';
import { continueReminderRecipient } from './calendar.js';
import { continueRetrieval } from './memory.js';
import { capture_start } from './memory.js';
import { register_document_template } from './documents.js';
import { store_credential } from './memory.js';
import { store_contact } from './memory.js';
import { continueMemoryCapture } from './memory.js';
import { recall_memory } from './memory.js';
import { retrieve_document } from './documents.js';
import { retrieve_email_code } from './email.js';
import { retrieve_email_data } from './email.js';
import { send_email } from './email.js';
import { capabilities } from './conversation.js';
import { generate_image } from './creative.js';
import { video_request } from './creative.js';
import { generate_document } from './documents.js';
import { transcribe_audio } from './creative.js';
import { set_calendar_pin } from './calendar.js';
import { create_reminder } from './calendar.js';
import { stacy_screenshot } from './desktop.js';
import { save_memory } from './memory.js';
import { stageMemory } from './memory.js';
import { job_generate_image } from './jobs/creative.js';
import { job_generate_story } from './jobs/creative.js';
import { job_edit_image } from './jobs/creative.js';
import { job_generate_document } from './jobs/documents.js';
import { job_send_email } from './jobs/email.js';
import { job_prepare_direct_email_attachment } from './jobs/email.js';
import { job_prepare_scheduled_email_attachment } from './jobs/email.js';
import { job_transcribe_audio } from './jobs/creative.js';

export const earlyExecutors = Object.freeze({ socialGreeting, literalNote, requestDesktopLink, continueDesktopLink, continueStoryPortrait, continueAudio, continueImageEdit, readStagedImage, editStagedImage, continueDocumentTemplate, continueReminderAttachment, stageImage });
export const orderedExecutors = Object.freeze([cancel, team_control, story_portrait, story_visual_reference_save, story_visual_reference_stop, story_auto_on, story_single_create, story_campaign_start, story_campaign_pause, story_campaign_status, marketing_review, project_update, project_list, project_query, edit_image, instagram_operation, continueDocumentDelivery, continueEmailDelivery, continueReminderRecipient, continueRetrieval, capture_start, register_document_template, store_credential, store_contact, continueMemoryCapture, recall_memory, retrieve_document, retrieve_email_code, retrieve_email_data, send_email, capabilities, generate_image, video_request, generate_document, transcribe_audio, set_calendar_pin, create_reminder, stacy_screenshot, save_memory, stageMemory]);
export const jobExecutors = Object.freeze({"generate_image": job_generate_image, "generate_story": job_generate_story, "edit_image": job_edit_image, "generate_document": job_generate_document, "send_email": job_send_email, "prepare_direct_email_attachment": job_prepare_direct_email_attachment, "prepare_scheduled_email_attachment": job_prepare_scheduled_email_attachment, "transcribe_audio": job_transcribe_audio});

// Public skill-to-executor map. Continuations remain in the ordered pipeline
// above; their priority is part of the conversational protocol.
export const skillExecutors = Object.freeze({
  ...Object.fromEntries(orderedExecutors.filter(fn => !fn.name.startsWith('continue')).map(fn => [fn.name, fn])),
  chat: capabilities,
  stage_memory: stageMemory,
  story_auto_off: story_auto_on,
  stacy_command: stacy_screenshot,
  stacy_status: stacy_screenshot,
});
