import type { ReplacementResultQualityContext } from "./result-quality.ts";

export interface ReplacementRegressionFixture {
  name: string;
  context: ReplacementResultQualityContext;
  shopping: Record<string, unknown>[];
  organic: Record<string, unknown>[];
  acceptedTitles: string[];
}

export const replacementRegressionFixtures: ReplacementRegressionFixture[] = [
  {
    name: "refined HP 14-inch laptop",
    context: {
      itemName: "Laptop",
      searchTerm: "Silver HP laptop 14-inch",
      brand: "HP",
      category: "Computers",
    },
    shopping: [],
    organic: [
      {
        title: "14-inch > Laptops - Shop HP.com New Zealand",
        displayLink: "HP",
        link: "https://www.hp.com/nz-en/shop/laptops-tablets/laptops.html?screen_size=14-inch",
        snippet: "Filter HP laptops by screen size, processor and price.",
      },
      {
        title: "HP Laptops for Work, Study & Everyday Use",
        displayLink: "HP",
        link: "https://www.hp.com/nz-en/shop/laptops.html",
        snippet: "Browse all HP laptop products.",
      },
      {
        title: "HP 14-inch Laptop Intel Core i5 16GB 512GB Silver",
        displayLink: "Harvey Norman",
        link: "https://www.harveynorman.co.nz/computers/laptops/hp-14-inch-i5-silver.html",
        snippet: "Our Price $1,299.00. Available online and in store.",
      },
    ],
    acceptedTitles: ["HP 14-inch Laptop Intel Core i5 16GB 512GB Silver"],
  },
  {
    name: "initial black monitor riser",
    context: {
      itemName: "Black monitor riser",
      category: "Office furniture",
    },
    shopping: [],
    organic: [
      {
        title: "Monitor Mounts, Accessories, Risers & Stands",
        displayLink: "PB Tech",
        link: "https://www.pbtech.co.nz/category/peripherals/monitor-mounts",
        snippet: "Shop mounts, brackets, arms and accessories.",
      },
      {
        title: "Computer Desk with Built-in Monitor Stand",
        displayLink: "The Warehouse",
        link: "https://www.thewarehouse.co.nz/p/computer-desk-monitor-stand/R123.html",
        snippet: "$149.00",
      },
      {
        title: "Black Monitor Riser Stand",
        displayLink: "OfficeMax",
        link: "https://www.officemax.co.nz/office-products/desk-accessories/black-monitor-riser-12345",
        snippet: "NOW $26.96. In stock.",
      },
    ],
    acceptedTitles: ["Black Monitor Riser Stand"],
  },
  {
    name: "refined Sony HT-S400 soundbar",
    context: {
      itemName: "Soundbar and subwoofer",
      searchTerm: "Sony HT-S400 soundbar wireless subwoofer",
      brand: "Sony",
      model: "HT-S400",
      category: "Home audio",
    },
    shopping: [
      {
        title: "Sony HT-S400 2.1ch Soundbar with Wireless Subwoofer",
        source: "JB Hi-Fi",
        extractedPrice: 449,
        price: "$499.00",
        link: "https://www.jbhifi.co.nz/",
        position: 1,
      },
    ],
    organic: [
      {
        title: "Sony HT-S400 Setup Guide",
        displayLink: "YouTube",
        link: "https://www.youtube.com/watch?v=hts400",
        snippet: "How to connect your soundbar.",
      },
      {
        title: "Trade in your old Sony soundbar",
        displayLink: "Trade Me",
        link: "https://example.co.nz/trade-in/soundbar",
      },
      {
        title: "Sony New Zealand",
        displayLink: "Sony",
        link: "https://www.sony.co.nz/",
      },
    ],
    acceptedTitles: ["Sony HT-S400 2.1ch Soundbar with Wireless Subwoofer"],
  },
  {
    name: "known exact Samsung S95D model",
    context: {
      itemName: "Television",
      searchTerm: "Samsung 65-inch OLED television",
      brand: "Samsung",
      model: "QA65S95D",
      category: "Electronics",
    },
    shopping: [
      {
        title: "Samsung QA65S95D 65-inch OLED 4K Smart TV",
        source: "Noel Leeming",
        currentPrice: { amount: 4999 },
        link: "https://www.noelleeming.co.nz/p/samsung-qa65s95d-oled-tv/N222222.html",
        position: 1,
      },
      {
        title: "Samsung Television Wall Mount Bracket",
        source: "Marketplace",
        price: "$80.00",
        link: "https://example.co.nz/products/samsung-tv-wall-mount",
        position: 2,
      },
    ],
    organic: [],
    acceptedTitles: ["Samsung QA65S95D 65-inch OLED 4K Smart TV"],
  },
];
