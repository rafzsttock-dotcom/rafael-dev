import { InlineKeyboard } from 'grammy'

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text('🖥 VPS List', 'vps_list').text('➕ Add VPS', 'add_vps').row()
    .text('📊 Status All', 'status_all')
}

export function vpsListKeyboard(vpsList) {
  const kb = new InlineKeyboard()
  for (const v of vpsList) {
    kb.text(`🖥 ${v.name}`, `vps_detail:${v.id}`).row()
  }
  kb.text('➕ Add VPS', 'add_vps').row()
  kb.text('← Back', 'main_menu')
  return kb
}

export function vpsDetailKeyboard(vpsId) {
  return new InlineKeyboard()
    .text('🚀 Deploy', `deploy_pick:${vpsId}`).text('📊 Status', `status:${vpsId}`).row()
    .text('⚡ Run CMD', `run_cmd:${vpsId}`).text('🗑 Delete', `vps_delete:${vpsId}`).row()
    .text('← Back', 'vps_list')
}

export function deployProjectKeyboard(projects, vpsId) {
  const kb = new InlineKeyboard()
  for (const p of projects) {
    kb.text(`📦 ${p.name}`, `deploy_confirm:${vpsId}:${p.id}`).row()
  }
  kb.text('← Back', `vps_detail:${vpsId}`)
  return kb
}

export function confirmDeployKeyboard(vpsId, projectId) {
  return new InlineKeyboard()
    .text('✅ Deploy', `deploy_run:${vpsId}:${projectId}`).text('❌ Cancel', 'main_menu')
}

export function authTypeKeyboard() {
  return new InlineKeyboard()
    .text('🔑 Password', 'auth_password').text('🗝 SSH Key', 'auth_key')
}

export function statusDetailKeyboard(vpsId) {
  return new InlineKeyboard()
    .text('🔄 Refresh', `status:${vpsId}`).row()
    .text('← Back', `vps_detail:${vpsId}`)
}

export function deleteConfirmKeyboard(vpsId) {
  return new InlineKeyboard()
    .text('✅ Ya, hapus', `vps_delete_confirm:${vpsId}`).text('❌ Batal', `vps_detail:${vpsId}`)
}

export function backToMainKeyboard() {
  return new InlineKeyboard().text('← Menu Utama', 'main_menu')
}

export function addVpsButtonKeyboard() {
  return new InlineKeyboard()
    .text('➕ Add VPS', 'add_vps').row()
    .text('← Back', 'main_menu')
}
