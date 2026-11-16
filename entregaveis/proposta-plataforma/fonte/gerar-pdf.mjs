// Gera o PDF da proposta a partir de proposta.html (A4, fontes incorporadas).
// Uso, a partir da pasta server/:  node ../entregaveis/proposta-plataforma/fonte/gerar-pdf.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { launch } = await import(pathToFileURL(path.resolve(here, '../../../server/scripts/screenshot.js')).href);
const out = path.resolve(here, '../Maputo_Blue_Plataforma_Digital_Proposta_Comercial.pdf');

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(here, 'proposta.html')).href, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  // Nada pode ficar cortado: cada página A4 tem de conter o seu conteúdo
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.page')].map((p, i) => {
    const pad = p.querySelector('.pad');
    const box = p.getBoundingClientRect();
    const over = pad ? pad.scrollHeight - pad.clientHeight : 0;
    const outside = [...p.querySelectorAll('.pad *')].some(el => el.getBoundingClientRect().bottom > box.bottom - 18 * 3.78);
    return { page: i + 1, over, outside };
  }).filter(x => x.over > 1 || x.outside));
  if (overflow.length) console.log('ATENÇÃO, conteúdo a mais em:', JSON.stringify(overflow));
  await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  console.log('PDF:', out, Math.round(fs.statSync(out).size / 1024) + ' KB');
} finally {
  await browser.close();
}
