// Renders a stacked bar per scenario: the orange segment is pnpm 12's time,
// the gray extension is the additional time pnpm 11 takes. Total bar length
// equals pnpm 11's time, so you can see at a glance how much faster v12 is.

const getMax = (results) => Math.max(...results.map((r) => r.v11))

export default (results, formattedNow) => {
  const v12Color = '#fbae00'
  const extraColor = '#cccccc'

  const offset = { left: 40, right: 10, top: 35, bottom: 10 }
  const thickness = 10
  const separation = 5

  const graph = {
    x: offset.left,
    y: offset.top,
    w: 250,
    h: results.length * (thickness + separation),
  }

  const vb = {
    x: 0,
    y: 0,
    w: graph.w + offset.left + offset.right,
    h: graph.h + offset.top + offset.bottom,
  }

  const max = getMax(results)
  const limit = Math.ceil(max / 5) * 5
  const ratio = graph.w / limit

  const styles = {
    font: '.font { font-family: sans-serif; }',
    s3: '.s3 { font-size: 3px; }',
    s4: '.s4 { font-size: 4px; }',
    s5: '.s5 { font-size: 5px; }',
    line: '.line { stroke: #cacaca; }',
    width: '.width { stroke-width: 0.5; }',
    text: '.text { fill: #888; }',
  }

  let svgStr = ''
  svgStr += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" '
  svgStr += `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">\n`

  svgStr += '  <style>\n'
  Object.values(styles).forEach((s) => { svgStr += `    ${s}\n` })
  svgStr += '  </style>\n'

  svgStr += `  <rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#fff"></rect>\n`

  // Legend: orange = pnpm 12, gray = additional time pnpm 11 takes.
  const legends = [
    { color: v12Color, label: 'pnpm 12' },
    { color: extraColor, label: 'additional time pnpm 11 takes' },
  ]
  legends.forEach((leg, i) => {
    const radius = 4
    const x = graph.x + radius + i * 80
    const y = vb.y + radius + 2
    svgStr += `  <circle cx="${x}" cy="${y}" r="${radius}" fill="${leg.color}"></circle>\n`
    svgStr += `  <text x="${x + radius + 2}" y="${y + 1}" class="font s4" dominant-baseline="middle" text-anchor="start">${leg.label}</text>\n`
  })

  const graphLines = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => graph.x + limit * ratio * f)
  let baseGraphLine = ''
  graphLines.forEach((gl, i) => {
    const isBase = i === 0
    const compositeClass = isBase ? 'line' : 'line width'
    const y1 = graph.y - separation
    const y2 = y1 + graph.h
    const line = `  <line x1="${gl}" y1="${y1}" x2="${gl}" y2="${y2}" class="${compositeClass}"></line>\n`
    if (isBase) baseGraphLine = line
    else svgStr += line

    const num = limit * (i / (graphLines.length - 1))
    svgStr += `  <text x="${gl}" y="${graph.y - 7}" class="font s5 text" text-anchor="middle">${num}</text>\n`
    svgStr += `  <text x="${gl}" y="${y2 + 5}" class="font s5 text" text-anchor="middle">${num}</text>\n`
  })

  svgStr += `  <text x="${graph.x + graph.w}" y="${graph.y - 15}" class="font s4 text" font-style="italic" text-anchor="end">Installation time in seconds (lower is better)</text>\n`

  // Stacked bars: full v11 length in gray, v12 portion overlaid in orange.
  results.forEach((r, indexT) => {
    const y = graph.y + (thickness + separation) * indexT
    const v11Len = Math.max(1, Math.round(r.v11 * ratio))
    const v12Len = Math.max(1, Math.round(r.v12 * ratio))
    svgStr += `  <rect x="${graph.x}" y="${y}" width="${v11Len}" height="${thickness}" fill="${extraColor}" rx="1" ry="1"></rect>\n`
    svgStr += `  <rect x="${graph.x}" y="${y}" width="${v12Len}" height="${thickness}" fill="${v12Color}" rx="1" ry="1"></rect>\n`
  })

  svgStr += baseGraphLine

  // Labels on the left, centered vertically on each bar.
  const labelSpacing = 4
  results.forEach((r, indexT) => {
    const labelBlockOffset = ((r.label.length - 1) * labelSpacing) / 2
    r.label.forEach((line, indexP) => {
      const y = graph.y + (thickness + separation) * indexT + thickness / 2 - labelBlockOffset + indexP * labelSpacing
      svgStr += `  <text x="${graph.x - 2}" y="${y}" class="font s4" dominant-baseline="middle" text-anchor="end">${line}</text>\n`
    })
  })

  svgStr += `  <text x="${graph.x + graph.w}" y="${vb.h - 2}" class="font s4 text" text-anchor="end">Tests were run using Node.js ${process.version} at: ${formattedNow}</text>\n`

  svgStr += '</svg>\n'
  return svgStr
}
