// The Orbit Live companion's binding to VS Code (Orbit 1.8.5): companion.js holds what it does; this file hands it
// VS Code's API, the file system and a timer. No dependency, no build step: VS Code runs this file as it is.
'use strict'

const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { createCompanion } = require('./companion.js')

function activate(context) {
  const every = (ms, fn) => ((id) => () => clearInterval(id))(setInterval(fn, ms))
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  const companion = createCompanion({ vscode, fs, path, os, env: process.env, pid: process.pid, uid, now: () => Date.now(), every })
  context.subscriptions.push(companion)
}

function deactivate() {}

module.exports = { activate, deactivate }
