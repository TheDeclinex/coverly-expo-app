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
  {
    name: "initial black curved gaming monitor",
    context: {
      itemName: "Black curved gaming monitor",
    },
    shopping: [],
    organic: [
      {
        title: "Samsung Odyssey G5 32-inch Curved Gaming Monitor",
        displayLink: "Noel Leeming",
        link: "https://www.noelleeming.co.nz/p/samsung-odyssey-g5-curved-gaming-monitor/N214881.html",
        snippet: "QHD 165Hz gaming display with a curved panel.",
      },
      {
        title: "AOC CQ32G3SE 31.5-inch Curved Gaming Monitor",
        displayLink: "Computer Lounge",
        link: "https://computerlounge.co.nz/gaming-monitors/aoc-cq32g3se.html",
        snippet: "A 165Hz QHD curved monitor for gaming.",
      },
      {
        title: "LG UltraGear 34-inch Curved Gaming Display",
        displayLink: "Harvey Norman",
        link: "https://www.harveynorman.co.nz/computers/monitors/lg-ultragear-34-curved.html",
        snippet: "UltraWide gaming display with 160Hz refresh rate.",
      },
      {
        title: "Gaming Monitors",
        displayLink: "Retailer",
        link: "https://example.co.nz/category/gaming-monitors",
        snippet: "Browse all gaming monitor products.",
      },
    ],
    acceptedTitles: [
      "Samsung Odyssey G5 32-inch Curved Gaming Monitor",
      "AOC CQ32G3SE 31.5-inch Curved Gaming Monitor",
      "LG UltraGear 34-inch Curved Gaming Display",
    ],
  },
  {
    name: "initial black subwoofer speaker",
    context: {
      itemName: "Black subwoofer speaker",
    },
    shopping: [
      {
        title: "Home Theatre Speakers & Subwoofers",
        source: "PriceSpy",
        price: "$199.00",
        link: "https://pricespy.co.nz/c/home-theatre-speakers-subwoofers",
      },
      {
        title: "Subwoofer speaker - Find the best price",
        source: "PriceMe",
        price: "$149.00",
        link: "https://www.priceme.co.nz/s/subwoofer-speaker",
      },
    ],
    organic: [
      {
        title: "Sony SA-SW5 Wireless Powered Subwoofer",
        displayLink: "Noel Leeming",
        link: "https://www.noelleeming.co.nz/p/sony-sa-sw5-wireless-subwoofer/N209997.html",
        snippet: "Our Price $899.00. Add deep bass to your home theatre.",
      },
      {
        title: "Polk Audio HTS 10 Powered Subwoofer",
        displayLink: "Harvey Norman",
        link: "https://www.harveynorman.co.nz/audio/subwoofers/polk-hts-10.html",
        snippet: "A compact active subwoofer for home theatre systems.",
      },
      {
        title: "Yamaha NS-SW100 Active Subwoofer",
        displayLink: "Yamaha New Zealand",
        link: "https://nz.yamaha.com/en/products/audio_visual/subwoofers/ns-sw100.html",
        snippet: "Powered bass speaker with twisted flare port.",
      },
      {
        title: "Home Theatre Speakers & Subwoofers",
        displayLink: "Retailer",
        link: "https://example.co.nz/category/subwoofers",
      },
    ],
    acceptedTitles: [
      "Sony SA-SW5 Wireless Powered Subwoofer",
      "Yamaha NS-SW100 Active Subwoofer",
      "Polk Audio HTS 10 Powered Subwoofer",
    ],
  },
  {
    name: "initial black toaster",
    context: {
      itemName: "Black toaster",
    },
    shopping: [
      {
        title: "Black toaster",
        source: "Appliance retailer",
        price: "$49.00",
        link: "https://example.co.nz/p/black-toaster/T100.html",
      },
      {
        title: "Toasters",
        source: "Retailer",
        price: "$29.00",
        link: "https://example.co.nz/appliances/toasters",
      },
    ],
    organic: [
      {
        title: "Breville the Smart Toast 4-Slice Black Toaster",
        displayLink: "Noel Leeming",
        link: "https://www.noelleeming.co.nz/p/breville-smart-toast-black/N204411.html",
        snippet: "Four-slice toaster with automatic lift and look.",
      },
      {
        title: "Russell Hobbs Addison 4-Slice Black Toaster",
        displayLink: "Briscoes",
        link: "https://www.briscoes.co.nz/kitchen/toasters/russell-hobbs-addison-black.html",
        snippet: "Our Price $89.99.",
      },
      {
        title: "Sunbeam Alinea 2-Slice Black Toaster",
        displayLink: "Farmers",
        link: "https://www.farmers.co.nz/product/sunbeam-alinea-black-toaster",
        snippet: "A two-slice toaster with variable browning control.",
      },
      {
        title: "Toasters",
        displayLink: "Retailer",
        link: "https://example.co.nz/category/toasters",
      },
    ],
    acceptedTitles: [
      "Russell Hobbs Addison 4-Slice Black Toaster",
      "Black toaster",
      "Breville the Smart Toast 4-Slice Black Toaster",
      "Sunbeam Alinea 2-Slice Black Toaster",
    ],
  },
  {
    name: "initial Dyson vacuum cleaner",
    context: {
      itemName: "Dyson vacuum cleaner",
      brand: "Dyson",
      category: "Appliances",
    },
    shopping: [
      {
        title: "Dyson V15 Detect Absolute Vacuum Cleaner",
        source: "Noel Leeming",
        salePrice: 1199,
        link: "https://www.noelleeming.co.nz/p/dyson-v15-detect/N300001.html",
      },
      {
        title: "Dyson V15 Replacement Filter for Vacuum Cleaner",
        source: "Marketplace",
        price: "$59.00",
        link: "https://example.co.nz/products/dyson-v15-filter",
      },
      {
        title: "Vacuum Cleaners",
        source: "Retailer",
        price: "$199.00",
        link: "https://example.co.nz/category/vacuum-cleaners",
      },
    ],
    organic: [
      {
        title: "Dyson Gen5detect Absolute Vacuum Cleaner",
        displayLink: "Harvey Norman",
        link: "https://www.harveynorman.co.nz/home-appliances/vacuums/dyson-gen5detect.html",
        snippet: "Our Price $1,499.00.",
      },
      {
        title: "Shark Detect Pro Cordless Vacuum Cleaner",
        displayLink: "Farmers",
        link: "https://www.farmers.co.nz/home/vacuums/shark-detect-pro",
        snippet: "Sale Price $799.00.",
      },
      {
        title: "Compare Vacuum Cleaner Prices",
        displayLink: "Comparison site",
        link: "https://example.co.nz/category/vacuum-cleaners",
      },
    ],
    acceptedTitles: [
      "Dyson V15 Detect Absolute Vacuum Cleaner",
      "Dyson Gen5detect Absolute Vacuum Cleaner",
      "Shark Detect Pro Cordless Vacuum Cleaner",
    ],
  },
  {
    name: "initial microwave",
    context: { itemName: "Microwave", category: "Appliances" },
    shopping: [
      {
        title: "Panasonic 32L Inverter Microwave Oven",
        source: "Noel Leeming",
        price: "$349.00",
        link: "https://www.noelleeming.co.nz/p/panasonic-32l-microwave/N300002.html",
      },
      {
        title: "Microwave Shelf and Storage Rack",
        source: "Marketplace",
        price: "$89.00",
        link: "https://example.co.nz/products/microwave-shelf",
      },
      {
        title: "Microwaves",
        source: "Retailer",
        price: "$149.00",
        link: "https://example.co.nz/category/microwaves",
      },
    ],
    organic: [
      {
        title: "LG NeoChef 42L Smart Inverter Microwave Oven",
        displayLink: "Harvey Norman",
        link: "https://www.harveynorman.co.nz/kitchen/microwaves/lg-neochef-42l.html",
        snippet: "Our Price $399.00.",
      },
      {
        title: "Samsung 40L Sensor Microwave Oven",
        displayLink: "Farmers",
        link: "https://www.farmers.co.nz/kitchen/samsung-40l-microwave",
        snippet: "NOW $329.00.",
      },
      {
        title: "How to Choose a Microwave",
        displayLink: "Retailer guide",
        link: "https://example.co.nz/blog/how-to-choose-a-microwave",
      },
    ],
    acceptedTitles: [
      "Panasonic 32L Inverter Microwave Oven",
      "LG NeoChef 42L Smart Inverter Microwave Oven",
      "Samsung 40L Sensor Microwave Oven",
    ],
  },
  {
    name: "initial dining chair",
    context: { itemName: "Dining chair", category: "Furniture" },
    shopping: [
      {
        title: "Oak Upholstered Dining Chair",
        source: "Mocka",
        price: "$199.00",
        link: "https://www.mocka.co.nz/products/oak-upholstered-dining-chair",
      },
      {
        title: "Oak Dining Table",
        source: "Furniture retailer",
        price: "$699.00",
        link: "https://example.co.nz/products/oak-dining-table",
      },
      {
        title: "Dining Chair Covers Set of 6",
        source: "Marketplace",
        price: "$79.00",
        link: "https://example.co.nz/products/dining-chair-covers",
      },
    ],
    organic: [
      {
        title: "Luna Fabric Dining Chair",
        displayLink: "Freedom",
        link: "https://www.freedomfurniture.co.nz/luna-fabric-dining-chair",
        snippet: "Our Price $249.00.",
      },
      {
        title: "Nora Timber Dining Chair",
        displayLink: "Target Furniture",
        link: "https://www.targetfurniture.co.nz/dining/nora-timber-chair.html",
        snippet: "Sale Price $179.00.",
      },
      {
        title: "Dining Chairs",
        displayLink: "Furniture retailer",
        link: "https://example.co.nz/category/dining-chairs",
      },
    ],
    acceptedTitles: [
      "Oak Upholstered Dining Chair",
      "Nora Timber Dining Chair",
      "Luna Fabric Dining Chair",
    ],
  },
  {
    name: "initial Breville coffee machine",
    context: {
      itemName: "Breville coffee machine",
      brand: "Breville",
      category: "Appliances",
    },
    shopping: [
      {
        title: "Breville Barista Express Coffee Machine",
        source: "Noel Leeming",
        currentPrice: { amount: 899 },
        link: "https://www.noelleeming.co.nz/p/breville-barista-express/N300003.html",
      },
      {
        title: "Breville Smart Grinder Coffee Grinder",
        source: "Retailer",
        price: "$349.00",
        link: "https://example.co.nz/products/breville-smart-grinder",
      },
      {
        title: "Coffee Machines",
        source: "Retailer",
        price: "$249.00",
        link: "https://example.co.nz/category/coffee-machines",
      },
    ],
    organic: [
      {
        title: "Breville Bambino Plus Espresso Machine",
        displayLink: "Harvey Norman",
        link: "https://www.harveynorman.co.nz/kitchen/coffee/breville-bambino-plus.html",
        snippet: "Our Price $699.00.",
      },
      {
        title: "Breville Barista Pro Coffee Machine",
        displayLink: "Farmers",
        link: "https://www.farmers.co.nz/kitchen/breville-barista-pro",
        snippet: "NOW $1,099.00.",
      },
      {
        title: "Coffee Machines",
        displayLink: "Retailer",
        link: "https://example.co.nz/category/coffee-machines",
      },
    ],
    acceptedTitles: [
      "Breville Barista Express Coffee Machine",
      "Breville Bambino Plus Espresso Machine",
      "Breville Barista Pro Coffee Machine",
    ],
  },
];
