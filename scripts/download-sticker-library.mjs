#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryDir = resolve(scriptDir, '..')
const manifestPath = join(repositoryDir, 'src', 'shared', 'asset-manifest.json')
const libraryDir = join(repositoryDir, 'resources', 'sticker-library')
const licensePath = join(libraryDir, 'licenses', 'fluent.txt')

function usage() {
  console.log('Usage: node scripts/download-sticker-library.mjs [--cache PATH] [--workers N] [--verify]')
}

function parseArguments(args) {
  const options = { cache: undefined, verify: false, workers: 12 }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--verify') {
      options.verify = true
    } else if (argument === '--cache' || argument === '--workers') {
      const value = args[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--cache') options.cache = resolve(value)
      else {
        options.workers = Number(value)
        if (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > 32) {
          throw new Error('--workers must be an integer between 1 and 32')
        }
      }
    } else if (argument === '--help' || argument === '-h') {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${argument}`)
    }
  }
  return options
}

function gitBlobSha1(content) {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
}

async function validateFile(path, asset) {
  try {
    const info = await stat(path)
    if (info.size !== asset.size) return false
    const content = await readFile(path)
    return gitBlobSha1(content) === asset.blob
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function validateLibrary(assets, license) {
  const missing = []
  for (const asset of assets) {
    const path = join(libraryDir, `${asset.blob}.png`)
    if (!(await validateFile(path, asset))) missing.push(asset.blob)
  }
  let licenseValid = false
  try {
    licenseValid = (await readFile(licensePath, 'utf8')) === license
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return { missing, licenseValid }
}

async function copyFromCache(asset, cacheDir) {
  if (!cacheDir) return false
  const cachedPath = join(cacheDir, `${asset.blob}.png`)
  if (!(await validateFile(cachedPath, asset))) return false
  const destination = join(libraryDir, `${asset.blob}.png`)
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await copyFile(cachedPath, temporary)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  return true
}

async function downloadAsset(asset) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const content = Buffer.from(await response.arrayBuffer())
  if (content.length !== asset.size || gitBlobSha1(content) !== asset.blob) {
    throw new Error('download did not match pinned size and Git blob SHA-1')
  }
  const destination = join(libraryDir, `${asset.blob}.png`)
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function runWorkers(items, workerCount, action) {
  let next = 0
  const workers = Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await action(item)
    }
  })
  await Promise.all(workers)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const stickers = manifest.assets.filter((asset) => asset.kind === 'sticker')
  const fluentStickers = stickers.filter((asset) => asset.license === 'fluent')
  if (fluentStickers.length !== 3144) {
    throw new Error(`Expected 3,144 Fluent sticker entries, found ${fluentStickers.length}`)
  }
  const fluentLicense = manifest.licenses.fluent
  if (typeof fluentLicense !== 'string') throw new Error('Manifest does not contain the Fluent license text')

  if (options.verify) {
    const result = await validateLibrary(fluentStickers, fluentLicense)
    const customStickers = stickers.filter(a => a.license !== 'fluent')
    const customMissing = []
    for (const asset of customStickers) {
      if (!(await validateFile(join(libraryDir, `${asset.blob}.png`), asset))) customMissing.push(asset)
    }
    if (result.missing.length || !result.licenseValid || customMissing.length) {
      console.error(`Verification failed: ${result.missing.length}/3144 Fluent, ${customMissing.length} custom missing; Fluent license ${result.licenseValid ? 'valid' : 'missing or changed'}.`)
      process.exitCode = 1
      return
    }
    console.log(`Verification passed: 3144 Fluent + ${customStickers.length} custom sticker files valid.`)
    return
  }

  await mkdir(join(libraryDir, 'licenses'), { recursive: true })
  await writeFile(licensePath, fluentLicense, 'utf8')
  const pending = []
  for (const asset of stickers) {
    if (!(await validateFile(join(libraryDir, `${asset.blob}.png`), asset))) pending.push(asset)
  }
  const result = { existing: stickers.length - pending.length, copied: 0, downloaded: 0, failed: [] }
  console.log(`Sticker library: ${result.existing} valid, ${pending.length} pending.`)
  await runWorkers(pending, options.workers, async (asset) => {
    try {
      if (await copyFromCache(asset, options.cache)) result.copied += 1
      else {
        await downloadAsset(asset)
        result.downloaded += 1
      }
    } catch (error) {
      result.failed.push({ blob: asset.blob, message: error.message })
    }
  })
  console.log(`Completed: ${result.existing} existing, ${result.copied} copied from cache, ${result.downloaded} downloaded, ${result.failed.length} failed.`)
  if (result.failed.length) {
    console.error(result.failed.map((failure) => `${failure.blob}: ${failure.message}`).join('\n'))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
