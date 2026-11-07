import { NodeSSH } from 'node-ssh'

export async function connectSSH(vpsConfig) {
  const ssh = new NodeSSH()
  const opts = {
    host: vpsConfig.host,
    port: vpsConfig.port,
    username: vpsConfig.user
  }
  if (vpsConfig.authType === 'key') {
    opts.privateKeyPath = vpsConfig.keyPath
  } else {
    opts.password = vpsConfig.password
  }
  await ssh.connect(opts)
  return ssh
}

export async function runCommand(ssh, cmd, cwd) {
  const result = await ssh.execCommand(cmd, { cwd })
  return { stdout: result.stdout, stderr: result.stderr, code: result.code }
}

export async function testConnection(vpsConfig) {
  let ssh
  try {
    ssh = await connectSSH(vpsConfig)
    await runCommand(ssh, 'echo ok', '/')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    if (ssh) disconnectSSH(ssh)
  }
}

export function disconnectSSH(ssh) {
  ssh.dispose()
}
