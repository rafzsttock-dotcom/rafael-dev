import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'

function getConfigPath() {
  if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH
  return join(dirname(fileURLToPath(import.meta.url)), '../../data/config.json')
}

export function loadConfig() {
  return JSON.parse(readFileSync(getConfigPath(), 'utf-8'))
}

export function saveConfig(config) {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2))
}

export function addVPS(vpsData) {
  const config = loadConfig()
  const vps = { id: randomUUID(), ...vpsData, projects: [] }
  config.vps.push(vps)
  saveConfig(config)
  return vps
}

export function removeVPS(id) {
  const config = loadConfig()
  config.vps = config.vps.filter(v => v.id !== id)
  saveConfig(config)
}

export function getVPS(id) {
  return loadConfig().vps.find(v => v.id === id)
}

export function listVPS() {
  return loadConfig().vps
}

export function addProject(vpsId, projectData) {
  const config = loadConfig()
  const vps = config.vps.find(v => v.id === vpsId)
  if (!vps) throw new Error(`VPS ${vpsId} not found`)
  const project = { id: randomUUID(), ...projectData }
  vps.projects.push(project)
  saveConfig(config)
  return project
}

export function updateProject(vpsId, projectId, patch) {
  const config = loadConfig()
  const project = config.vps.find(v => v.id === vpsId)?.projects.find(p => p.id === projectId)
  if (!project) return null
  Object.assign(project, patch)
  saveConfig(config)
  return project
}

export function removeProject(vpsId, projectId) {
  const config = loadConfig()
  const vps = config.vps.find(v => v.id === vpsId)
  if (!vps) throw new Error(`VPS ${vpsId} not found`)
  vps.projects = vps.projects.filter(p => p.id !== projectId)
  saveConfig(config)
}
