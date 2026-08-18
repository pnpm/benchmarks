
// Results are either a number (simple bar) or { primary, secondary } where
// the secondary value is rendered behind the primary in a different color
// (used for the pnpm 11/12 stacked bar).
const getHighestNumber = (resultArrays) => {
  let max = 0
  for (const row of resultArrays) {
    for (const val of row) {
      if (typeof val === 'number') {
        if (val > max) max = val
      } else if (val) {
        if (val.primary > max) max = val.primary
        if (val.secondary > max) max = val.secondary
      }
    }
  }
  return max
}

// `nodeVersion` is the Node.js the results were measured on. A reporting run
// draws a page it did not measure, so it can't use its own `process.version`.
export default (resultArrays, pms, tests, formattedNow, nodeVersion = process.version) => {
  let svgStr = ''
  // Expand stacked PM slots into two legend entries (primary + extra).
  const legendEntries = pms.flatMap((pm) => pm.stacked
    ? [
        { color: pm.color, legend: pm.legend, version: pm.version, displayVersion: pm.displayVersion },
        { color: pm.extraColor, legend: pm.extraLegend, noVersion: true },
      ]
    : [pm]
  )
  // empty areas next to the graph. The top has to hold the legend, the axis
  // explanation and the scale, each on a line of its own: the explanation is
  // anchored to the right edge and was drawn through the version under the
  // last legend entry.
  const offset = {
    left: 40,
    right: 10,
    top: 43,
    bottom: 10
  }
  // thickness of bars
  const thickness = 6
  // spacing between bars
  const spacing = 0.5
  // spacing between groups of bars
  const separation = 4
  // rectangle in which the graph will be drawn
  const graph = {
    x: offset.left,
    y: offset.top,
    w: 250,
    h: tests.length * pms.length * (thickness + spacing) +
      (tests.length - 1) * separation +
      separation * 2 // extra white space above first bar and below last bar
  }
  // viewbox dimensions
  const vb = {
    x: 0,
    y: 0,
    w: graph.w +
      offset.left +
      offset.right,
    h: graph.h + offset.top + offset.bottom
  }
  // get the highest number of the results so
  // that the graph can be scaled accordingly
  const max = getHighestNumber(resultArrays)
  // upper limit of graph is the highest result rounded
  // up to the nearest number divisible by 5
  const limit = Math.ceil(max / 5) * 5
  const ratio = graph.w / limit
  const styles = {
    font: '.font { font-family: sans-serif; }',
    s3: '.s3 { font-size: 3px; }',
    s4: '.s4 { font-size: 4px; }',
    s5: '.s5 { font-size: 5px; }',
    line: '.line { stroke: #cacaca; }',
    width: '.width { stroke-width: 0.5; }',
    text: '.text { fill: #888; }'
  }

  svgStr += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" '
  svgStr += `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">` + '\n'

  // add styles
  svgStr += '  <style>' + '\n'
  Object.values(styles).forEach((style) => {
    svgStr += `    ${style}` + '\n'
  })
  svgStr += '  </style>' + '\n'

  // add white background
  svgStr += `  <rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${'#fff'}"></rect>` + '\n'

  // uncomment to color the entire view box for debugging
  // svgStr += `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${'#eaeaea'}"></rect>` + '\n'

  // draw legend
  // Wider spacing when stacking adds long "extra" entries; default tight spacing for simple charts.
  const legendStepX = legendEntries.length > pms.length ? 36 : 16
  legendEntries.forEach((entry, index) => {
    const radius = 4
    const x = graph.x + radius + legendStepX * index
    const y = vb.y + radius + 2
    svgStr += `  <circle cx="${x}" cy="${y}" r="${radius}" fill="${entry.color}"></circle>` + '\n'

    const anchor = 'middle'
    let textY = y + radius + 4
    svgStr += `  <text x="${x}" y="${textY}" class="font s4" text-anchor="${anchor}">${entry.legend}</text>` + '\n'

    if (!entry.noVersion) {
      const text = `v${entry.displayVersion ?? entry.version}`
      textY += 4
      svgStr += `  <text x="${x}" y="${textY}" class="font s3" text-anchor="${anchor}">${text}</text>` + '\n'
    }
  })

  const graphLines = [
    graph.x + limit * ratio * 0,
    graph.x + limit * ratio * 0.2,
    graph.x + limit * ratio * 0.4,
    graph.x + limit * ratio * 0.6,
    graph.x + limit * ratio * 0.8,
    graph.x + limit * ratio * 1
  ]
  let baseGraphLine = ''

  // draw graph lines
  graphLines.forEach((graphLine, index) => {
    const isBaseLine = index === 0
    const compositeClass = isBaseLine
      ? 'line'
      : 'line width'
    const y1 = graph.y - separation
    const y2 = y1 + graph.h
    const line = `  <line x1="${graphLine}" y1="${y1}" x2="${graphLine}" y2="${y2}" class="${compositeClass}"></line>` + '\n'
    // add base graph line after the bars are drawn so that it is drawn over the bars
    if (isBaseLine) {
      baseGraphLine = line
    } else {
      svgStr += line
    }

    // add numbers above the graph lines
    const anchor = 'middle'
    const x = graphLine
    let y = graph.y - 7
    const number = limit * (index / (graphLines.length - 1))
    svgStr += `  <text x="${x}" y="${y}" class="font s5 text" text-anchor="${anchor}">${number}</text>` + '\n'

    // add numbers below the graph lines
    y = y2 + 5
    svgStr += `  <text x="${x}" y="${y}" class="font s5 text" text-anchor="${anchor}">${number}</text>` + '\n'
  })

  // add axis explanation
  ;(() => {
    const text = 'Installation time in seconds (lower is better)'
    const anchor = 'end'
    const fontStyle = 'italic'
    const x = graph.x + graph.w
    const y = graph.y - 15
    svgStr += `  <text x="${x}" y="${y}" class="font s4 text" font-style="${fontStyle}" text-anchor="${anchor}">${text}</text>` + '\n'
  })()

  // draw results as bars
  resultArrays.forEach((results, indexA) => {
    results.forEach((result, indexR) => {
      const pm = pms[indexR]
      const roundedCorners = 1
      const y = graph.y +
        ((thickness + spacing) * indexR) +
        (((thickness + spacing) * pms.length + separation) * indexA)
      const x = graph.x

      if (pm.stacked) {
        const sLen = Math.round((result.secondary ?? 0) * ratio)
        const pLen = Math.round((result.primary ?? 0) * ratio)
        if (sLen > 0) {
          svgStr += `  <rect x="${x}" y="${y}" width="${sLen}" height="${thickness}" fill="${pm.extraColor}" rx="${roundedCorners}" ry="${roundedCorners}"></rect>` + '\n'
        }
        if (pLen > 0) {
          svgStr += `  <rect x="${x}" y="${y}" width="${pLen}" height="${thickness}" fill="${pm.color}" rx="${roundedCorners}" ry="${roundedCorners}"></rect>` + '\n'
        }
      } else {
        const length = Math.round(result * ratio)
        svgStr += `  <rect x="${x}" y="${y}" width="${length}" height="${thickness}" fill="${pm.color}" rx="${roundedCorners}" ry="${roundedCorners}"></rect>` + '\n'
        if (pm.mascot && result > 0) {
          const mascotX = x + length + 2
          const mascotY = y + thickness / 2
          svgStr += `  <text x="${mascotX}" y="${mascotY}" class="font" font-size="7" dominant-baseline="central">${pm.mascot}</text>` + '\n'
        }
      }
    })
  })

  // draw base graph line over the bars
  svgStr += baseGraphLine

  // next to each bar group specify the properties of the test
  const groupHeight = thickness * pms.length + spacing * (pms.length - 1)
  const groupCenter = groupHeight / 2
  const labelSpacing = 4
  tests.forEach((properties, indexT) => {
    const labelBlockOffset = ((properties.length - 1) * labelSpacing) / 2
    properties.forEach((property, indexP) => {
      const baseline = 'middle'
      const anchor = 'end'
      const x = graph.x - 2
      const y = graph.y +
        ((thickness + spacing) * pms.length + separation) * indexT +
        groupCenter -
        labelBlockOffset +
        indexP * labelSpacing
      svgStr += `  <text x="${x}" y="${y}" class="font s4" dominant-baseline="${baseline}" text-anchor="${anchor}">${property}</text>` + '\n'
    })
  })

  // add node version
  ;(() => {
    const text = `Tests were run using Node.js ${nodeVersion} at: ${formattedNow}`
    const anchor = 'end'
    const x = graph.x + graph.w
    const y = vb.h - 2
    svgStr += `  <text x="${x}" y="${y}" class="font s4 text" text-anchor="${anchor}">${text}</text>` + '\n'
  })()

  svgStr += `</svg>` + '\n'

  return svgStr
}
