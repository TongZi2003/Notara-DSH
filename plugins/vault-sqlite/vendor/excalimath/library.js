/*! ExcaliMath - MIT - Copyright (c) 2026 ExcaliMath Contributors. See LICENSE and PROVENANCE.md. */

// work/references/excalimath/packages/core/src/core/elementFactory.ts
function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
function svgToDataUrl(svg) {
  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml,${encoded}`;
}
function createFileEntry(dataUrl, id) {
  const fileId = id ?? generateId();
  return {
    fileId,
    fileEntry: {
      mimeType: "image/svg+xml",
      id: fileId,
      dataURL: dataUrl,
      created: Date.now(),
      lastRetrieved: Date.now()
    }
  };
}

// work/references/excalimath/packages/core/src/plugins/geometry/packs/geometry.ts
var geometryShapes = [
  {
    name: "Right Triangle",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 80, points: [[0, 80], [100, 80], [0, 0], [0, 80]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 0, y: 65, width: 15, height: 15, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Equilateral Triangle",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 87, points: [[50, 0], [100, 87], [0, 87], [50, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Isosceles Triangle",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 80, points: [[50, 0], [100, 80], [0, 80], [50, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Circle",
    elements: [
      { type: "ellipse", x: 0, y: 0, width: 100, height: 100, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Circle with Radius",
    elements: [
      { type: "ellipse", x: 0, y: 0, width: 100, height: 100, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 50, y: 50, width: 50, height: 0, points: [[0, 0], [50, 0]], strokeColor: "#e03131", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 55, y: 32, width: 10, height: 14, text: "r", fontSize: 14, fontFamily: 1, strokeColor: "#e03131" }
    ]
  },
  {
    name: "Square",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 80, height: 80, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Rectangle",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 120, height: 80, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Pentagon",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 95, points: [[50, 0], [100, 35], [81, 95], [19, 95], [0, 35], [50, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Hexagon",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 87, points: [[25, 0], [75, 0], [100, 43], [75, 87], [25, 87], [0, 43], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Parallelogram",
    elements: [
      { type: "line", x: 0, y: 0, width: 140, height: 70, points: [[30, 0], [140, 0], [110, 70], [0, 70], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Trapezoid",
    elements: [
      { type: "line", x: 0, y: 0, width: 140, height: 70, points: [[30, 0], [110, 0], [140, 70], [0, 70], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Angle (30\xB0)",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 60, points: [[0, 60], [100, 60]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 0, y: 0, width: 100, height: 60, points: [[0, 60], [87, 10]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 25, y: 42, width: 24, height: 14, text: "30\xB0", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Right Angle",
    elements: [
      { type: "line", x: 0, y: 0, width: 100, height: 80, points: [[0, 0], [0, 80]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 0, y: 0, width: 100, height: 80, points: [[0, 80], [100, 80]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 0, y: 65, width: 15, height: 15, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 18, y: 60, width: 24, height: 14, text: "90\xB0", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Coordinate Grid",
    elements: [
      { type: "arrow", x: 0, y: 100, width: 200, height: 0, points: [[0, 0], [200, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: "arrow" },
      { type: "arrow", x: 100, y: 0, width: 0, height: 200, points: [[0, 0], [0, 200]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: "arrow" },
      { type: "text", x: 195, y: 103, width: 10, height: 14, text: "x", fontSize: 14, fontFamily: 1, strokeColor: "#1e1e1e" },
      { type: "text", x: 103, y: -2, width: 10, height: 14, text: "y", fontSize: 14, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Number Line",
    elements: [
      { type: "arrow", x: 0, y: 20, width: 240, height: 0, points: [[0, 0], [240, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: "arrow" },
      ...Array.from({ length: 11 }, (_, i) => ({
        type: "line",
        x: i * 22 + 10,
        y: 15,
        width: 0,
        height: 10,
        points: [[0, 0], [0, 10]],
        strokeColor: "#1e1e1e",
        strokeWidth: 1,
        roughness: 0
      }))
    ]
  },
  {
    name: "Protractor",
    elements: [
      { type: "line", x: 0, y: 60, width: 120, height: 0, points: [[0, 0], [120, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 0, y: 0, width: 120, height: 120, strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 52, y: 62, width: 20, height: 14, text: "0\xB0", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 115, y: 52, width: 24, height: 14, text: "90\xB0", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 48, y: -4, width: 28, height: 14, text: "180\xB0", fontSize: 10, fontFamily: 1, strokeColor: "#888" }
    ]
  }
];

// work/references/excalimath/packages/core/src/plugins/geometry/packs/algebra.ts
var algebraShapes = [
  {
    name: "Fraction Bar",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 60, height: 30, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 0, y: 30, width: 60, height: 0, points: [[0, 0], [60, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 0, y: 30, width: 60, height: 30, strokeColor: "#1e1e1e", backgroundColor: "#ffd8a8", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Algebra Tile (x)",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 80, height: 30, strokeColor: "#1e1e1e", backgroundColor: "#b2f2bb", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 32, y: 6, width: 16, height: 18, text: "x", fontSize: 18, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" }
    ]
  },
  {
    name: "Algebra Tile (1)",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 30, height: 30, strokeColor: "#1e1e1e", backgroundColor: "#ffc9c9", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 9, y: 6, width: 12, height: 18, text: "1", fontSize: 18, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" }
    ]
  },
  {
    name: "Algebra Tile (x\xB2)",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 80, height: 80, strokeColor: "#1e1e1e", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 28, y: 28, width: 24, height: 18, text: "x\xB2", fontSize: 18, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" }
    ]
  },
  {
    name: "Balance Scale",
    elements: [
      { type: "line", x: 60, y: 120, width: 0, height: 80, points: [[0, 0], [0, 80]], strokeColor: "#1e1e1e", strokeWidth: 3, roughness: 0 },
      { type: "line", x: 30, y: 200, width: 60, height: 0, points: [[0, 0], [60, 0]], strokeColor: "#1e1e1e", strokeWidth: 3, roughness: 0 },
      { type: "line", x: 0, y: 120, width: 120, height: 0, points: [[0, 0], [120, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 0, y: 110, width: 0, height: 20, points: [[0, 0], [0, 20]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 120, y: 110, width: 0, height: 20, points: [[0, 0], [0, 20]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: -20, y: 130, width: 40, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 100, y: 130, width: 40, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#ffd8a8", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Venn Diagram (2 sets)",
    elements: [
      { type: "ellipse", x: 0, y: 0, width: 120, height: 100, strokeColor: "#1971c2", backgroundColor: "transparent", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 60, y: 0, width: 120, height: 100, strokeColor: "#e03131", backgroundColor: "transparent", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 30, y: 40, width: 12, height: 16, text: "A", fontSize: 16, fontFamily: 1, strokeColor: "#1971c2" },
      { type: "text", x: 140, y: 40, width: 12, height: 16, text: "B", fontSize: 16, fontFamily: 1, strokeColor: "#e03131" }
    ]
  },
  {
    name: "Venn Diagram (3 sets)",
    elements: [
      { type: "ellipse", x: 20, y: 0, width: 100, height: 80, strokeColor: "#1971c2", backgroundColor: "transparent", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 60, y: 0, width: 100, height: 80, strokeColor: "#e03131", backgroundColor: "transparent", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 40, y: 30, width: 100, height: 80, strokeColor: "#2f9e44", backgroundColor: "transparent", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 35, y: 25, width: 12, height: 16, text: "A", fontSize: 14, fontFamily: 1, strokeColor: "#1971c2" },
      { type: "text", x: 130, y: 25, width: 12, height: 16, text: "B", fontSize: 14, fontFamily: 1, strokeColor: "#e03131" },
      { type: "text", x: 80, y: 90, width: 12, height: 16, text: "C", fontSize: 14, fontFamily: 1, strokeColor: "#2f9e44" }
    ]
  },
  {
    name: "Function Machine",
    elements: [
      { type: "rectangle", x: 20, y: 30, width: 80, height: 60, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0, roundness: { type: 3 } },
      { type: "text", x: 38, y: 50, width: 40, height: 16, text: "f(x)", fontSize: 16, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" },
      { type: "arrow", x: -30, y: 60, width: 50, height: 0, points: [[0, 0], [50, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "arrow", x: 100, y: 60, width: 50, height: 0, points: [[0, 0], [50, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "text", x: -40, y: 42, width: 30, height: 14, text: "Input", fontSize: 11, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 115, y: 42, width: 40, height: 14, text: "Output", fontSize: 11, fontFamily: 1, strokeColor: "#888" }
    ]
  },
  {
    name: "Number Cards (0-9)",
    elements: Array.from({ length: 10 }, (_, i) => [
      { type: "rectangle", x: i * 35, y: 0, width: 30, height: 40, strokeColor: "#1e1e1e", backgroundColor: "#fff9db", fillStyle: "solid", strokeWidth: 1, roughness: 0, roundness: { type: 3 } },
      { type: "text", x: i * 35 + 8, y: 8, width: 14, height: 20, text: String(i), fontSize: 20, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" }
    ]).flat()
  }
];

// work/references/excalimath/packages/core/src/plugins/geometry/packs/statistics.ts
var statisticsShapes = [
  {
    name: "Bar Chart Frame",
    elements: [
      { type: "arrow", x: 30, y: 0, width: 0, height: 120, points: [[0, 0], [0, 120]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, startArrowhead: "arrow", endArrowhead: null },
      { type: "arrow", x: 30, y: 120, width: 180, height: 0, points: [[0, 0], [180, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "rectangle", x: 45, y: 40, width: 25, height: 80, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 80, y: 60, width: 25, height: 60, strokeColor: "#e03131", backgroundColor: "#ffc9c9", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 115, y: 20, width: 25, height: 100, strokeColor: "#2f9e44", backgroundColor: "#b2f2bb", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 150, y: 50, width: 25, height: 70, strokeColor: "#e8590c", backgroundColor: "#ffd8a8", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Pie Chart (4 segments)",
    elements: [
      { type: "ellipse", x: 0, y: 0, width: 120, height: 120, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 60, y: 0, width: 0, height: 60, points: [[0, 0], [0, 60]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 60, y: 60, width: 60, height: 0, points: [[0, 0], [60, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 60, y: 60, width: 0, height: 60, points: [[0, 0], [0, 60]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 0, y: 60, width: 60, height: 0, points: [[0, 0], [60, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 70, y: 22, width: 24, height: 14, text: "25%", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" },
      { type: "text", x: 70, y: 70, width: 24, height: 14, text: "25%", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" },
      { type: "text", x: 22, y: 70, width: 24, height: 14, text: "25%", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" },
      { type: "text", x: 22, y: 22, width: 24, height: 14, text: "25%", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Histogram Frame",
    elements: [
      { type: "arrow", x: 30, y: 0, width: 0, height: 120, points: [[0, 0], [0, 120]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, startArrowhead: "arrow", endArrowhead: null },
      { type: "arrow", x: 30, y: 120, width: 180, height: 0, points: [[0, 0], [180, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "rectangle", x: 35, y: 60, width: 30, height: 60, strokeColor: "#6965db", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 65, y: 30, width: 30, height: 90, strokeColor: "#6965db", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 95, y: 10, width: 30, height: 110, strokeColor: "#6965db", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 125, y: 40, width: 30, height: 80, strokeColor: "#6965db", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 155, y: 70, width: 30, height: 50, strokeColor: "#6965db", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 80, y: 128, width: 60, height: 14, text: "Frequency", fontSize: 11, fontFamily: 1, strokeColor: "#888", textAlign: "center" }
    ]
  },
  {
    name: "Scatter Plot Axes",
    elements: [
      { type: "arrow", x: 30, y: 0, width: 0, height: 150, points: [[0, 0], [0, 150]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, startArrowhead: "arrow", endArrowhead: null },
      { type: "arrow", x: 30, y: 150, width: 180, height: 0, points: [[0, 0], [180, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "ellipse", x: 55, y: 100, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 80, y: 80, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 100, y: 60, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 130, y: 45, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 160, y: 25, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 70, y: 110, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 120, y: 70, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 150, y: 40, width: 6, height: 6, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Box Plot Frame",
    elements: [
      { type: "line", x: 30, y: 40, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 30, y: 60, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      { type: "rectangle", x: 60, y: 30, width: 60, height: 60, strokeColor: "#1e1e1e", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 90, y: 30, width: 0, height: 60, points: [[0, 0], [0, 60]], strokeColor: "#e03131", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 120, y: 60, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 150, y: 40, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 20, y: 85, width: 24, height: 12, text: "Min", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 55, y: 85, width: 16, height: 12, text: "Q1", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 78, y: 85, width: 24, height: 12, text: "Med", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 110, y: 85, width: 16, height: 12, text: "Q3", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 140, y: 85, width: 24, height: 12, text: "Max", fontSize: 10, fontFamily: 1, strokeColor: "#888" }
    ]
  }
];

// work/references/excalimath/packages/core/src/plugins/geometry/packs/physics.ts
var physicsShapes = [
  // ══════════════════════════════════════
  // ── Basic Components ──
  // ══════════════════════════════════════
  {
    name: "Wire",
    elements: [
      { type: "line", x: 0, y: 20, width: 100, height: 0, points: [[0, 0], [100, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Cell",
    elements: [
      { type: "line", x: 0, y: 25, width: 35, height: 0, points: [[0, 0], [35, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Long line (positive)
      { type: "line", x: 35, y: 8, width: 0, height: 34, points: [[0, 0], [0, 34]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Short line (negative)
      { type: "line", x: 45, y: 15, width: 0, height: 20, points: [[0, 0], [0, 20]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 45, y: 25, width: 35, height: 0, points: [[0, 0], [35, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 31, y: -4, width: 10, height: 12, text: "+", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" },
      { type: "text", x: 44, y: -4, width: 10, height: 12, text: "-", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Battery",
    elements: [
      { type: "line", x: 0, y: 25, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Long-short-long-short pattern
      { type: "line", x: 30, y: 8, width: 0, height: 34, points: [[0, 0], [0, 34]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 37, y: 15, width: 0, height: 20, points: [[0, 0], [0, 20]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 44, y: 8, width: 0, height: 34, points: [[0, 0], [0, 34]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 51, y: 15, width: 0, height: 20, points: [[0, 0], [0, 20]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 51, y: 25, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 25, y: -4, width: 10, height: 12, text: "+", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" },
      { type: "text", x: 52, y: -4, width: 10, height: 12, text: "-", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Switch (Open)",
    elements: [
      { type: "line", x: 0, y: 30, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 28, y: 27, width: 6, height: 6, strokeColor: "#1e1e1e", backgroundColor: "#1e1e1e", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 31, y: 30, width: 40, height: -20, points: [[0, 0], [40, -20]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 68, y: 27, width: 6, height: 6, strokeColor: "#1e1e1e", backgroundColor: "#1e1e1e", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 74, y: 30, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Switch (Closed)",
    elements: [
      { type: "line", x: 0, y: 30, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 28, y: 27, width: 6, height: 6, strokeColor: "#1e1e1e", backgroundColor: "#1e1e1e", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 31, y: 30, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 68, y: 27, width: 6, height: 6, strokeColor: "#1e1e1e", backgroundColor: "#1e1e1e", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 74, y: 30, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Ground",
    elements: [
      { type: "line", x: 40, y: 0, width: 0, height: 20, points: [[0, 0], [0, 20]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 20, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 27, y: 28, width: 26, height: 0, points: [[0, 0], [26, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 34, y: 36, width: 12, height: 0, points: [[0, 0], [12, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  // ══════════════════════════════════════
  // ── Resistors & Passive Components ──
  // ══════════════════════════════════════
  {
    name: "Resistor",
    elements: [
      { type: "line", x: 0, y: 20, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 20, width: 60, height: 0, points: [[0, 0], [10, -15], [20, 15], [30, -15], [40, 15], [50, -15], [60, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 80, y: 20, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Resistor (IEC Box)",
    elements: [
      { type: "line", x: 0, y: 20, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 25, y: 8, width: 50, height: 24, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 75, y: 20, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Variable Resistor",
    elements: [
      { type: "line", x: 0, y: 25, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 25, y: 13, width: 50, height: 24, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 75, y: 25, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Diagonal arrow through the box
      { type: "arrow", x: 22, y: 40, width: 56, height: -32, points: [[0, 0], [56, -32]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null }
    ]
  },
  {
    name: "Thermistor",
    elements: [
      { type: "line", x: 0, y: 25, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 25, y: 13, width: 50, height: 24, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 75, y: 25, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Diagonal line through the box (no arrow for thermistor)
      { type: "line", x: 28, y: 34, width: 44, height: -22, points: [[0, 0], [44, -22]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Fuse",
    elements: [
      { type: "line", x: 0, y: 20, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 25, y: 10, width: 50, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#1e1e1e", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 75, y: 20, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "LDR",
    elements: [
      { type: "line", x: 0, y: 25, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 25, y: 13, width: 50, height: 24, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 75, y: 25, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Light arrows pointing in
      { type: "arrow", x: 30, y: 5, width: 10, height: 6, points: [[0, 0], [10, 6]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "arrow", x: 38, y: 2, width: 10, height: 6, points: [[0, 0], [10, 6]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0, endArrowhead: "arrow", startArrowhead: null }
    ]
  },
  {
    name: "Capacitor",
    elements: [
      { type: "line", x: 0, y: 25, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 40, y: 5, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 55, y: 5, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 55, y: 25, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Inductor",
    elements: [
      { type: "line", x: 0, y: 20, width: 15, height: 0, points: [[0, 0], [15, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 15, y: 20, width: 15, height: 0, points: [[0, 0], [3, -12], [12, -12], [15, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 30, y: 20, width: 15, height: 0, points: [[0, 0], [3, -12], [12, -12], [15, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 45, y: 20, width: 15, height: 0, points: [[0, 0], [3, -12], [12, -12], [15, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 60, y: 20, width: 15, height: 0, points: [[0, 0], [3, -12], [12, -12], [15, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 75, y: 20, width: 15, height: 0, points: [[0, 0], [15, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  // ══════════════════════════════════════
  // ── Semiconductor Devices ──
  // ══════════════════════════════════════
  {
    name: "Diode",
    elements: [
      { type: "line", x: 0, y: 25, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Triangle
      { type: "line", x: 30, y: 25, width: 20, height: 0, points: [[0, -15], [0, 15], [20, 0], [0, -15]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Bar
      { type: "line", x: 50, y: 10, width: 0, height: 30, points: [[0, 0], [0, 30]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 50, y: 25, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "LED",
    elements: [
      { type: "line", x: 0, y: 25, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Triangle
      { type: "line", x: 30, y: 25, width: 20, height: 0, points: [[0, -15], [0, 15], [20, 0], [0, -15]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Bar
      { type: "line", x: 50, y: 10, width: 0, height: 30, points: [[0, 0], [0, 30]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 50, y: 25, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Light arrows going out
      { type: "arrow", x: 44, y: 2, width: 12, height: -8, points: [[0, 0], [12, -8]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "arrow", x: 50, y: 5, width: 12, height: -8, points: [[0, 0], [12, -8]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0, endArrowhead: "arrow", startArrowhead: null }
    ]
  },
  {
    name: "Transistor (NPN)",
    elements: [
      // Base lead (left)
      { type: "line", x: 0, y: 30, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Vertical bar at base
      { type: "line", x: 25, y: 10, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 3, roughness: 0 },
      // Collector line (top-right)
      { type: "line", x: 25, y: 18, width: 25, height: -18, points: [[0, 0], [25, -18]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Collector lead up
      { type: "line", x: 50, y: 0, width: 0, height: 10, points: [[0, 0], [0, 10]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Emitter line (bottom-right) with arrow
      { type: "arrow", x: 25, y: 42, width: 25, height: 18, points: [[0, 0], [25, 18]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      // Emitter lead down
      { type: "line", x: 50, y: 50, width: 0, height: 10, points: [[0, 0], [0, 10]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Circle around it
      { type: "ellipse", x: 12, y: 2, width: 48, height: 56, strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      // Labels
      { type: "text", x: -2, y: 18, width: 8, height: 10, text: "B", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 54, y: -6, width: 8, height: 10, text: "C", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 54, y: 52, width: 8, height: 10, text: "E", fontSize: 10, fontFamily: 1, strokeColor: "#888" }
    ]
  },
  {
    name: "Transistor (PNP)",
    elements: [
      // Base lead (left)
      { type: "line", x: 0, y: 30, width: 25, height: 0, points: [[0, 0], [25, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Vertical bar at base
      { type: "line", x: 25, y: 10, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 3, roughness: 0 },
      // Collector line (top-right)
      { type: "line", x: 25, y: 18, width: 25, height: -18, points: [[0, 0], [25, -18]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Collector lead up
      { type: "line", x: 50, y: 0, width: 0, height: 10, points: [[0, 0], [0, 10]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Emitter line (bottom-right) with arrow pointing IN (toward base)
      { type: "arrow", x: 50, y: 60, width: -25, height: -18, points: [[0, 0], [-25, -18]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      // Emitter lead down
      { type: "line", x: 50, y: 50, width: 0, height: 10, points: [[0, 0], [0, 10]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Circle around it
      { type: "ellipse", x: 12, y: 2, width: 48, height: 56, strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      // Labels
      { type: "text", x: -2, y: 18, width: 8, height: 10, text: "B", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 54, y: -6, width: 8, height: 10, text: "C", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 54, y: 52, width: 8, height: 10, text: "E", fontSize: 10, fontFamily: 1, strokeColor: "#888" }
    ]
  },
  // ══════════════════════════════════════
  // ── Meters & Output Devices ──
  // ══════════════════════════════════════
  {
    name: "Ammeter",
    elements: [
      { type: "line", x: 0, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 20, y: 5, width: 40, height: 40, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 32, y: 14, width: 16, height: 20, text: "A", fontSize: 20, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" },
      { type: "line", x: 60, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Voltmeter",
    elements: [
      { type: "line", x: 0, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 20, y: 5, width: 40, height: 40, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 32, y: 14, width: 16, height: 20, text: "V", fontSize: 20, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" },
      { type: "line", x: 60, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Motor",
    elements: [
      { type: "line", x: 0, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 20, y: 5, width: 40, height: 40, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 31, y: 14, width: 16, height: 20, text: "M", fontSize: 20, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" },
      { type: "line", x: 60, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Lamp",
    elements: [
      { type: "line", x: 0, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 20, y: 5, width: 40, height: 40, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // X cross inside
      { type: "line", x: 27, y: 12, width: 26, height: 26, points: [[0, 0], [26, 26]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 27, y: 38, width: 26, height: -26, points: [[0, 0], [26, -26]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 60, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Buzzer",
    elements: [
      { type: "line", x: 0, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      // Buzzer body (D shape)
      { type: "line", x: 20, y: 5, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 5, width: 25, height: 40, points: [[0, 0], [15, 0], [25, 10], [25, 30], [15, 40], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 45, y: 25, width: 20, height: 0, points: [[0, 0], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  },
  // ══════════════════════════════════════
  // ── Logic Gates (SVG with smooth curves) ──
  // ══════════════════════════════════════
  // AND: flat left, curved right
  {
    name: "AND Gate",
    elements: [],
    svgWidth: 90,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="15" x2="20" y2="15"/><line x1="0" y1="35" x2="20" y2="35"/><path d="M20,0 L20,50 L45,50 C65,50 70,25 70,25 C70,25 65,0 45,0 Z"/><line x1="70" y1="25" x2="90" y2="25"/></svg>`
  },
  // OR: curved left, pointed right
  {
    name: "OR Gate",
    elements: [],
    svgWidth: 90,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="15" x2="24" y2="15"/><line x1="0" y1="35" x2="24" y2="35"/><path d="M15,0 Q30,25 15,50"/><path d="M15,0 C25,0 50,0 70,25 C50,50 25,50 15,50"/><line x1="70" y1="25" x2="90" y2="25"/></svg>`
  },
  // NOT: triangle + bubble
  {
    name: "NOT Gate",
    elements: [],
    svgWidth: 90,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="25" x2="20" y2="25"/><polygon points="20,0 20,50 60,25"/><circle cx="65" cy="25" r="5"/><line x1="70" y1="25" x2="90" y2="25"/></svg>`
  },
  // NAND: AND + bubble
  {
    name: "NAND Gate",
    elements: [],
    svgWidth: 98,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="98" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="15" x2="20" y2="15"/><line x1="0" y1="35" x2="20" y2="35"/><path d="M20,0 L20,50 L45,50 C65,50 70,25 70,25 C70,25 65,0 45,0 Z"/><circle cx="75" cy="25" r="5"/><line x1="80" y1="25" x2="98" y2="25"/></svg>`
  },
  // NOR: OR + bubble
  {
    name: "NOR Gate",
    elements: [],
    svgWidth: 98,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="98" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="15" x2="24" y2="15"/><line x1="0" y1="35" x2="24" y2="35"/><path d="M15,0 Q30,25 15,50"/><path d="M15,0 C25,0 50,0 70,25 C50,50 25,50 15,50"/><circle cx="75" cy="25" r="5"/><line x1="80" y1="25" x2="98" y2="25"/></svg>`
  },
  // XOR: OR + extra curved line on left
  {
    name: "XOR Gate",
    elements: [],
    svgWidth: 90,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="15" x2="24" y2="15"/><line x1="0" y1="35" x2="24" y2="35"/><path d="M10,0 Q25,25 10,50"/><path d="M15,0 Q30,25 15,50"/><path d="M15,0 C25,0 50,0 70,25 C50,50 25,50 15,50"/><line x1="70" y1="25" x2="90" y2="25"/></svg>`
  },
  // XNOR: XOR + bubble
  {
    name: "XNOR Gate",
    elements: [],
    svgWidth: 98,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="98" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="15" x2="24" y2="15"/><line x1="0" y1="35" x2="24" y2="35"/><path d="M10,0 Q25,25 10,50"/><path d="M15,0 Q30,25 15,50"/><path d="M15,0 C25,0 50,0 70,25 C50,50 25,50 15,50"/><circle cx="75" cy="25" r="5"/><line x1="80" y1="25" x2="98" y2="25"/></svg>`
  },
  // Buffer: triangle (no bubble)
  {
    name: "Buffer",
    elements: [],
    svgWidth: 80,
    svgHeight: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50" fill="none" stroke="#1e1e1e" stroke-width="2"><line x1="0" y1="25" x2="20" y2="25"/><polygon points="20,0 20,50 60,25"/><line x1="60" y1="25" x2="80" y2="25"/></svg>`
  },
  // ══════════════════════════════════════
  // ── Force Arrows ──
  // ══════════════════════════════════════
  {
    name: "Force Arrow",
    elements: [
      { type: "arrow", x: 0, y: 20, width: 100, height: 0, points: [[0, 0], [100, 0]], strokeColor: "#e03131", strokeWidth: 3, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "text", x: 35, y: 2, width: 12, height: 16, text: "F", fontSize: 16, fontFamily: 1, strokeColor: "#e03131" }
    ]
  },
  {
    name: "Force Arrows (Balanced)",
    elements: [
      { type: "arrow", x: 60, y: 30, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeColor: "#e03131", strokeWidth: 3, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "arrow", x: 60, y: 30, width: -80, height: 0, points: [[0, 0], [-80, 0]], strokeColor: "#1971c2", strokeWidth: 3, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "ellipse", x: 55, y: 25, width: 10, height: 10, strokeColor: "#1e1e1e", backgroundColor: "#1e1e1e", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  }
];

// work/references/excalimath/packages/core/src/plugins/geometry/packs/biology.ts
var biologyShapes = [
  {
    name: "Animal Cell",
    elements: [
      { type: "ellipse", x: 0, y: 0, width: 180, height: 140, strokeColor: "#e8590c", backgroundColor: "#fff4e6", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 60, y: 40, width: 50, height: 50, strokeColor: "#862e9c", backgroundColor: "#f3d9fa", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 72, y: 55, width: 20, height: 18, strokeColor: "#862e9c", backgroundColor: "#862e9c", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 65, y: 95, width: 42, height: 12, text: "Nucleus", fontSize: 10, fontFamily: 1, strokeColor: "#862e9c" },
      { type: "ellipse", x: 130, y: 50, width: 30, height: 15, strokeColor: "#2f9e44", backgroundColor: "#d8f5a2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 122, y: 68, width: 50, height: 12, text: "Mitochondria", fontSize: 8, fontFamily: 1, strokeColor: "#2f9e44" },
      { type: "ellipse", x: 15, y: 30, width: 30, height: 20, strokeColor: "#1971c2", backgroundColor: "#d0ebff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 12, y: 52, width: 36, height: 12, text: "ER", fontSize: 10, fontFamily: 1, strokeColor: "#1971c2" }
    ]
  },
  {
    name: "Plant Cell",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 180, height: 140, strokeColor: "#2f9e44", backgroundColor: "#ebfbee", fillStyle: "solid", strokeWidth: 3, roughness: 0 },
      { type: "rectangle", x: 5, y: 5, width: 170, height: 130, strokeColor: "#2f9e44", backgroundColor: "#d8f5a2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 55, y: 35, width: 50, height: 50, strokeColor: "#862e9c", backgroundColor: "#f3d9fa", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 62, y: 90, width: 42, height: 12, text: "Nucleus", fontSize: 10, fontFamily: 1, strokeColor: "#862e9c" },
      { type: "ellipse", x: 120, y: 20, width: 40, height: 30, strokeColor: "#087f5b", backgroundColor: "#96f2d7", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 116, y: 52, width: 50, height: 12, text: "Chloroplast", fontSize: 8, fontFamily: 1, strokeColor: "#087f5b" },
      { type: "rectangle", x: 15, y: 100, width: 50, height: 25, strokeColor: "#1971c2", backgroundColor: "#d0ebff", fillStyle: "solid", strokeWidth: 1, roughness: 0, roundness: { type: 3 } },
      { type: "text", x: 18, y: 105, width: 44, height: 12, text: "Vacuole", fontSize: 10, fontFamily: 1, strokeColor: "#1971c2" },
      { type: "text", x: 55, y: -15, width: 60, height: 12, text: "Cell Wall", fontSize: 10, fontFamily: 1, strokeColor: "#2f9e44" }
    ]
  },
  {
    name: "DNA Helix Segment",
    elements: [
      { type: "line", x: 20, y: 0, width: 0, height: 120, points: [[0, 0], [-15, 20], [15, 40], [-15, 60], [15, 80], [-15, 100], [0, 120]], strokeColor: "#1971c2", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 60, y: 0, width: 0, height: 120, points: [[0, 0], [15, 20], [-15, 40], [15, 60], [-15, 80], [15, 100], [0, 120]], strokeColor: "#e03131", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 5, y: 20, width: 70, height: 0, points: [[0, 0], [70, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 5, y: 60, width: 70, height: 0, points: [[0, 0], [70, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "line", x: 5, y: 100, width: 70, height: 0, points: [[0, 0], [70, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 25, y: 125, width: 30, height: 14, text: "DNA", fontSize: 12, fontFamily: 1, strokeColor: "#1e1e1e" }
    ]
  },
  {
    name: "Food Web Arrow",
    elements: [
      { type: "ellipse", x: 0, y: 0, width: 60, height: 30, strokeColor: "#2f9e44", backgroundColor: "#d8f5a2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 6, y: 6, width: 50, height: 14, text: "Producer", fontSize: 10, fontFamily: 1, strokeColor: "#2f9e44", textAlign: "center" },
      { type: "arrow", x: 60, y: 15, width: 30, height: 0, points: [[0, 0], [30, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "ellipse", x: 90, y: 0, width: 70, height: 30, strokeColor: "#e8590c", backgroundColor: "#fff4e6", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 96, y: 6, width: 58, height: 14, text: "Consumer", fontSize: 10, fontFamily: 1, strokeColor: "#e8590c", textAlign: "center" }
    ]
  },
  {
    name: "Ecosystem Icons (Sun + Water + Soil)",
    elements: [
      { type: "ellipse", x: 10, y: 0, width: 30, height: 30, strokeColor: "#e8590c", backgroundColor: "#fff3bf", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 14, y: 32, width: 22, height: 12, text: "Sun", fontSize: 10, fontFamily: 1, strokeColor: "#e8590c" },
      { type: "ellipse", x: 60, y: 5, width: 25, height: 20, strokeColor: "#1971c2", backgroundColor: "#d0ebff", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 58, y: 28, width: 30, height: 12, text: "Water", fontSize: 10, fontFamily: 1, strokeColor: "#1971c2" },
      { type: "rectangle", x: 105, y: 10, width: 30, height: 18, strokeColor: "#862e9c", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 108, y: 30, width: 24, height: 12, text: "Soil", fontSize: 10, fontFamily: 1, strokeColor: "#862e9c" }
    ]
  },
  {
    name: "Mitosis Stages",
    elements: [
      { type: "ellipse", x: 0, y: 10, width: 40, height: 40, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 12, y: 22, width: 16, height: 16, strokeColor: "#862e9c", backgroundColor: "#f3d9fa", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 4, y: 53, width: 36, height: 10, text: "Interphase", fontSize: 8, fontFamily: 1, strokeColor: "#888" },
      { type: "arrow", x: 42, y: 30, width: 15, height: 0, points: [[0, 0], [15, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "ellipse", x: 60, y: 10, width: 40, height: 40, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 70, y: 20, width: 20, height: 20, points: [[0, 0], [20, 20]], strokeColor: "#862e9c", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 70, y: 40, width: 20, height: -20, points: [[0, 0], [20, -20]], strokeColor: "#862e9c", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 64, y: 53, width: 36, height: 10, text: "Metaphase", fontSize: 8, fontFamily: 1, strokeColor: "#888" },
      { type: "arrow", x: 102, y: 30, width: 15, height: 0, points: [[0, 0], [15, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0, endArrowhead: "arrow", startArrowhead: null },
      { type: "ellipse", x: 120, y: 5, width: 50, height: 50, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 145, y: 10, width: 0, height: 40, points: [[0, 0], [0, 40]], strokeColor: "#1e1e1e", strokeWidth: 1, roughness: 0 },
      { type: "text", x: 126, y: 58, width: 36, height: 10, text: "Telophase", fontSize: 8, fontFamily: 1, strokeColor: "#888" }
    ]
  }
];

// work/references/excalimath/packages/core/src/plugins/geometry/packs/chemistry.ts
var chemistryShapes = [
  {
    name: "Atom Model (Bohr)",
    elements: [
      { type: "ellipse", x: 40, y: 40, width: 20, height: 20, strokeColor: "#e03131", backgroundColor: "#ffc9c9", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 44, y: 44, width: 12, height: 12, text: "N", fontSize: 10, fontFamily: 1, strokeColor: "#e03131", textAlign: "center" },
      { type: "ellipse", x: 10, y: 10, width: 80, height: 80, strokeColor: "#1971c2", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: -5, y: -5, width: 110, height: 110, strokeColor: "#1971c2", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 6, y: 10, width: 8, height: 8, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 86, y: 45, width: 8, height: 8, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: -5, y: 60, width: 8, height: 8, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 },
      { type: "ellipse", x: 98, y: 75, width: 8, height: 8, strokeColor: "#1971c2", backgroundColor: "#1971c2", fillStyle: "solid", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Periodic Table Tile",
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 70, height: 80, strokeColor: "#1e1e1e", backgroundColor: "#e7f5ff", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "text", x: 5, y: 3, width: 16, height: 12, text: "11", fontSize: 10, fontFamily: 1, strokeColor: "#888" },
      { type: "text", x: 18, y: 18, width: 36, height: 28, text: "Na", fontSize: 28, fontFamily: 1, strokeColor: "#1e1e1e", textAlign: "center" },
      { type: "text", x: 8, y: 50, width: 54, height: 12, text: "Sodium", fontSize: 11, fontFamily: 1, strokeColor: "#555", textAlign: "center" },
      { type: "text", x: 12, y: 64, width: 46, height: 10, text: "22.990", fontSize: 10, fontFamily: 1, strokeColor: "#888", textAlign: "center" }
    ]
  },
  {
    name: "Single Bond",
    elements: [
      { type: "ellipse", x: 0, y: 10, width: 20, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 20, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 60, y: 10, width: 20, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Double Bond",
    elements: [
      { type: "ellipse", x: 0, y: 10, width: 20, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 17, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 23, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 60, y: 10, width: 20, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Triple Bond",
    elements: [
      { type: "ellipse", x: 0, y: 10, width: 20, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 14, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 20, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 26, width: 40, height: 0, points: [[0, 0], [40, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 60, y: 10, width: 20, height: 20, strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", fillStyle: "solid", strokeWidth: 2, roughness: 0 }
    ]
  },
  {
    name: "Beaker",
    elements: [
      { type: "line", x: 0, y: 0, width: 70, height: 100, points: [[0, 0], [0, 90], [10, 100], [60, 100], [70, 90], [70, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 5, y: 50, width: 60, height: 45, strokeColor: "transparent", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 0, roughness: 0, opacity: 60 },
      { type: "line", x: -5, y: 25, width: 10, height: 0, points: [[0, 0], [10, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "line", x: -5, y: 50, width: 10, height: 0, points: [[0, 0], [10, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0 },
      { type: "line", x: -5, y: 75, width: 10, height: 0, points: [[0, 0], [10, 0]], strokeColor: "#888", strokeWidth: 1, roughness: 0 }
    ]
  },
  {
    name: "Erlenmeyer Flask",
    elements: [
      { type: "line", x: 0, y: 0, width: 80, height: 100, points: [[25, 0], [25, 30], [0, 100], [80, 100], [55, 30], [55, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 0, y: 0, width: 80, height: 100, points: [[25, 0], [55, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 10, y: 60, width: 60, height: 36, strokeColor: "transparent", backgroundColor: "#b2f2bb", fillStyle: "solid", strokeWidth: 0, roughness: 0, opacity: 60 }
    ]
  },
  {
    name: "Test Tube",
    elements: [
      { type: "line", x: 0, y: 0, width: 20, height: 80, points: [[0, 0], [0, 70]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "line", x: 20, y: 0, width: 0, height: 80, points: [[0, 0], [0, 70]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "ellipse", x: 0, y: 65, width: 20, height: 15, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 },
      { type: "rectangle", x: 2, y: 40, width: 16, height: 30, strokeColor: "transparent", backgroundColor: "#d0bfff", fillStyle: "solid", strokeWidth: 0, roughness: 0, opacity: 60 },
      { type: "line", x: -4, y: 0, width: 28, height: 0, points: [[0, 0], [28, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0 }
    ]
  }
];

// work/references/excalimath/packages/core/src/plugins/geometry/registry.ts
var builtInPacks = [
  {
    name: "Geometry",
    description: "Angles, triangles, circles, polygons, coordinate grids, number lines",
    gradeRange: "K-10",
    shapes: geometryShapes,
    enabled: true
  },
  {
    name: "Algebra",
    description: "Fraction bars, algebra tiles, balance scales, Venn diagrams, function machine",
    gradeRange: "Gr 3-10",
    shapes: algebraShapes,
    enabled: true
  },
  {
    name: "Statistics",
    description: "Bar chart, pie chart, histogram, scatter plot, box plot frames",
    gradeRange: "Gr 5-12",
    shapes: statisticsShapes,
    enabled: true
  },
  {
    name: "Physics / Circuits",
    description: "Resistor, capacitor, battery, switch, LED, logic gates, force arrows",
    gradeRange: "Gr 8-12",
    shapes: physicsShapes,
    enabled: true
  },
  {
    name: "Biology",
    description: "Animal cell, plant cell, DNA helix, mitosis stages, food web, ecosystem",
    gradeRange: "Gr 5-12",
    shapes: biologyShapes,
    enabled: true
  },
  {
    name: "Chemistry",
    description: "Atom models, periodic table tiles, bond types, lab equipment",
    gradeRange: "Gr 7-12",
    shapes: chemistryShapes,
    enabled: true
  }
];
function generateId2() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
function shapeToExcalidrawElements(shape, x, y) {
  if (shape.svg) {
    const dataUrl = svgToDataUrl(shape.svg);
    const { fileId, fileEntry } = createFileEntry(dataUrl);
    const elementId = generateId2();
    const element = {
      id: elementId,
      type: "image",
      x,
      y,
      width: shape.svgWidth || 90,
      height: shape.svgHeight || 50,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 0,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: null,
      roundness: null,
      seed: Math.floor(Math.random() * 1e5),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e5),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      status: "saved",
      fileId,
      scale: [1, 1]
    };
    return { elements: [element], files: [fileEntry] };
  }
  const groupId = generateId2();
  const elements = shape.elements.map((el) => {
    const id = generateId2();
    const base = {
      id,
      type: el.type,
      x: x + (el.x || 0),
      y: y + (el.y || 0),
      width: el.width || 0,
      height: el.height || 0,
      angle: el.angle || 0,
      strokeColor: el.strokeColor || "#1e1e1e",
      backgroundColor: el.backgroundColor || "transparent",
      fillStyle: el.fillStyle || "solid",
      strokeWidth: el.strokeWidth ?? 2,
      roughness: el.roughness ?? 0,
      opacity: el.opacity ?? 100,
      groupIds: [groupId],
      frameId: null,
      index: null,
      roundness: el.roundness || null,
      seed: Math.floor(Math.random() * 1e5),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e5),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false
    };
    if (el.type === "text") {
      return {
        ...base,
        text: el.text || "",
        fontSize: el.fontSize || 16,
        fontFamily: el.fontFamily || 1,
        textAlign: el.textAlign || "left",
        verticalAlign: "top",
        containerId: null,
        originalText: el.text || "",
        autoResize: true,
        lineHeight: 1.25
      };
    }
    if (el.type === "line" || el.type === "arrow") {
      return {
        ...base,
        points: el.points || [[0, 0], [el.width, el.height]],
        startArrowhead: el.startArrowhead ?? null,
        endArrowhead: el.type === "arrow" ? el.endArrowhead ?? "arrow" : null,
        startBinding: null,
        endBinding: null,
        lastCommittedPoint: null
      };
    }
    return base;
  });
  return { elements, files: [] };
}
export {
  builtInPacks,
  shapeToExcalidrawElements
};
