import { copyFile, mkdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const webRoot = path.join(repoRoot, "apps/web")
const publicRoot = path.join(webRoot, "public/ocr")

async function packageJson(packagePath) {
  return JSON.parse(await readFile(path.join(packagePath, "package.json"), "utf8"))
}

async function assertPackageVersion(packagePath, expectedVersion, name) {
  const metadata = await packageJson(packagePath)
  if (metadata.version !== expectedVersion) {
    throw new Error(`${name} must be ${expectedVersion}; found ${metadata.version}`)
  }
}

async function copyFileChecked(source, destination) {
  const metadata = await stat(source)
  if (!metadata.isFile() || metadata.size < 1) throw new Error(`Missing OCR asset: ${source}`)
  await copyFile(source, destination)
}

const coreRoot = path.join(repoRoot, "node_modules/tesseract.js-core")
const tesseractRoot = path.join(repoRoot, "node_modules/tesseract.js")
await assertPackageVersion(coreRoot, "7.0.0", "tesseract.js-core")
await assertPackageVersion(tesseractRoot, "7.0.0", "tesseract.js")

const coreDestination = path.join(publicRoot, "7.0.0/core")
await mkdir(coreDestination, { recursive: true })
for (const variant of ["", "-simd", "-lstm", "-simd-lstm", "-relaxedsimd-lstm"]) {
  for (const extension of ["wasm.js", "wasm"]) {
    const filename = `tesseract-core${variant}.${extension}`
    await copyFileChecked(path.join(coreRoot, filename), path.join(coreDestination, filename))
  }
}
const licensesDestination = path.join(publicRoot, "7.0.0/licenses")
await mkdir(licensesDestination, { recursive: true })
await copyFileChecked(path.join(coreRoot, "LICENSE"), path.join(licensesDestination, "tesseract.js-core-LICENSE"))
await copyFileChecked(path.join(tesseractRoot, "LICENSE.md"), path.join(licensesDestination, "tesseract.js-LICENSE.md"))
await copyFileChecked(path.join(tesseractRoot, "dist/worker.min.js"), path.join(publicRoot, "7.0.0/worker.min.js"))
await copyFileChecked(path.join(tesseractRoot, "dist/worker.min.js.LICENSE.txt"), path.join(licensesDestination, "tesseract.js-worker-LICENSE.txt"))

const languageDestination = path.join(publicRoot, "1.0.0/lang")
await mkdir(languageDestination, { recursive: true })
for (const language of ["fra", "eng"]) {
  const packageRoot = path.join(repoRoot, `node_modules/@tesseract.js-data/${language}`)
  await assertPackageVersion(packageRoot, "1.0.0", `@tesseract.js-data/${language}`)
  await copyFileChecked(
    path.join(packageRoot, "4.0.0_best_int", `${language}.traineddata.gz`),
    path.join(languageDestination, `${language}.traineddata.gz`),
  )
}

console.info("Prepared local Tesseract.js 7.0.0 and French/English OCR assets.")
