// ===========================================================================
// EXTRAS CATALOG — offline library + optional tools for T.U.R.D.
//
// Every entry was checked against its official source on 2026-10-21:
//   · Kiwix ZIMs: file names + sizes from the official Kiwix mirrors
//     (ftp.fau.de/kiwix, mirrors.dotsrc.org/kiwix). At install time the app
//     asks library.kiwix.org for the newest build and its SHA-256, so a newer
//     monthly file is picked up automatically; the pinned file is the fallback.
//   · Windows apps: winget id → winget.js (installer URL + SHA-256 copied from
//     microsoft/winget-pkgs). Sizes marked v:1 were read off the release page.
//   · Android apps: package ids + sizes from f-droid.org / the project's own
//     GitHub releases; Play Store ids for apps that only ship there.
//   · Local AI: Ollama tag sizes from ollama.com/library, GGUF sizes from the
//     Hugging Face API (SHA-256 is re-read from the API at install time).
//
// Sizes are MiB. v:1 = size verified today, otherwise it's a close estimate and
// the real size is read from the server before anything downloads.
// ===========================================================================

export const CHECKED = "2026-10-21";
const KIWIX = "https://download.kiwix.org/zim/";

/* ------------------------------------------------------------ categories */
export const CATS = {
  // library (Kiwix content, readable on both platforms)
  wiki:   { label:"Encyclopedias",          tab:"library", icon:"W"  },
  med:    { label:"Medical",                tab:"library", icon:"+"  },
  prep:   { label:"Survival & prep",        tab:"library", icon:"▲"  },
  fix:    { label:"Fix it · How-to",        tab:"library", icon:"⚒"  },
  learn:  { label:"Learn",                  tab:"library", icon:"✎"  },
  tech:   { label:"Tech & code",            tab:"library", icon:"⌘"  },
  maps:   { label:"Travel & maps",          tab:"library", icon:"⌖"  },
  books:  { label:"Books",                  tab:"library", icon:"❡"  },
  fun:    { label:"Fun & games wikis",      tab:"library", icon:"✦"  },
  // apps
  read:   { label:"Offline readers",        tab:"apps", icon:"◎" },
  nav:    { label:"Maps & navigation",      tab:"apps", icon:"⌖" },
  sec:    { label:"Security & privacy",     tab:"apps", icon:"⛨" },
  files:  { label:"Files, sync & USB",      tab:"apps", icon:"⇅" },
  notes:  { label:"Notes, office & study",  tab:"apps", icon:"✎" },
  media:  { label:"Media",                  tab:"apps", icon:"▶" },
  games:  { label:"Games & handheld",       tab:"apps", icon:"◆" },
  radio:  { label:"Radio & off-grid comms", tab:"apps", icon:"⌁" },
  sys:    { label:"System tools",           tab:"apps", icon:"⚙" },
  // local AI
  airun:  { label:"AI runners",             tab:"ai", icon:"✦" },
  model:  { label:"Models",                 tab:"ai", icon:"◉" },
};

/* ------------------------------------------------------------ helpers */
// Kiwix ZIM. file = verified file name on the mirror today.
const z = (id, cat, name, dir, file, mb, desc, o={}) => ({
  id, cat, name, desc, mb, v:1, kind:"zim",
  zim:{ name:file.replace(/_\d{4}-\d{2}[a-z]?\.zim$/, ""), file, url:KIWIX+dir+"/"+file },
  src:"download.kiwix.org", both:true, ...o,
});
// App. win:{wg:"winget id"} or {url,page}; and:{pkg, fd:"f-droid apk url", play:true, apk, page}
const a = (id, cat, name, desc, o) => ({ id, cat, name, desc, kind:"app", ...o });

/* ===================================================================== LIBRARY */
export const LIBRARY = [
  /* ---- encyclopedias ---- */
  z("wp-top-mini","wiki","Wikipedia · Top 50,000 (mini)","wikipedia","wikipedia_en_top_mini_2026-09.zim",283,
    "The 50,000 most-read English articles, intro + infobox only. The best first download: fits on any phone.",{star:1,kits:["pocket"]}),
  z("wp-100","wiki","Wikipedia · 100 essentials","wikipedia","wikipedia_en_100_2026-08.zim",318,
    "Wikipedia's 100 core articles with full text and pictures. A great showcase and test file."),
  z("wp-top-nopic","wiki","Wikipedia · Top 50,000 (no pictures)","wikipedia","wikipedia_en_top_nopic_2026-09.zim",2662,
    "Same 50,000 articles with the full text. The sweet spot for small laptops and handhelds.",{kits:["deck"]}),
  z("wp-top-maxi","wiki","Wikipedia · Top 50,000 (with pictures)","wikipedia","wikipedia_en_top_maxi_2026-09.zim",6656,
    "The 50,000 most-read articles with full text and images."),
  z("wp-simple-mini","wiki","Simple English Wikipedia (mini)","wikipedia","wikipedia_en-simple_all_mini_2026-06.zim",450,
    "Every Simple English article (plain words, short sentences), intros only. Great for kids and ESL readers."),
  z("wp-simple-nopic","wiki","Simple English Wikipedia (no pictures)","wikipedia","wikipedia_en-simple_all_nopic_2026-06.zim",944,
    "All of Simple English Wikipedia, full text, under 1 GB.",{kits:["student"]}),
  z("wp-simple-maxi","wiki","Simple English Wikipedia (with pictures)","wikipedia","wikipedia_en-simple_all_maxi_2026-06.zim",3379,
    "All of Simple English Wikipedia with images."),
  z("wp-top1m-mini","wiki","Wikipedia · Top 1 million (mini)","wikipedia","wikipedia_en_top1m_mini_2026-04.zim",2867,
    "The top million articles, intros only. Huge coverage for under 3 GB."),
  z("wp-top1m-nopic","wiki","Wikipedia · Top 1 million (no pictures)","wikipedia","wikipedia_en_top1m_nopic_2026-04.zim",16384,
    "The top million articles, full text."),
  z("wp-all-mini","wiki","Wikipedia · ALL 6.9M articles (mini)","wikipedia","wikipedia_en_all_mini_2026-09.zim",13722,
    "Every English article, intro + infobox. The whole encyclopedia on a 16 GB card.",{star:1,kits:["prep"]}),
  z("wp-all-nopic","wiki","Wikipedia · ALL (full text, no pictures)","wikipedia","wikipedia_en_all_nopic_2026-06.zim",50278,
    "All of English Wikipedia, full text. Needs a 64 GB+ drive."),
  z("wp-all-maxi","wiki","Wikipedia · ALL (everything)","wikipedia","wikipedia_en_all_maxi_2026-08.zim",121549,
    "The complete English Wikipedia with images. 119 GB: plan on a 128 GB+ drive.",{big:1}),
  z("wiktionary","wiki","Wiktionary dictionary","wiktionary","wiktionary_en_all_nopic_2026-08.zim",8704,
    "Definitions, pronunciations, etymology and translations for millions of words."),
  z("wikibooks","wiki","Wikibooks textbooks","wikibooks","wikibooks_en_all_nopic_2026-04.zim",3379,
    "Thousands of free textbooks and manuals: cookbook, programming, first aid, languages and more."),
  z("factbook","wiki","CIA World Factbook","other","theworldfactbook_en_all_2026-02.zim",388,
    "Maps, flags, population, government, economy and military data for every country."),

  /* ---- medical ---- */
  z("mdwiki","med","WikiMed (MDWiki) medical encyclopedia","other","mdwiki_en_all_maxi_2025-11.zim",2150,
    "Kiwix's flagship medical library: thousands of doctor-reviewed articles on diseases, drugs, anatomy and first aid.",{star:1,kits:["prep"]}),
  z("wp-med-mini","med","Wikipedia Medicine (mini)","wikipedia","wikipedia_en_medicine_mini_2026-10.zim",166,
    "Every medical article on Wikipedia, intros only. Tiny, phone-friendly.",{star:1,kits:["pocket"]}),
  z("wp-med-nopic","med","Wikipedia Medicine (full text)","wikipedia","wikipedia_en_medicine_nopic_2026-10.zim",999,
    "All medical Wikipedia articles, full text, no images."),
  z("wp-med-maxi","med","Wikipedia Medicine (with pictures)","wikipedia","wikipedia_en_medicine_maxi_2026-10.zim",1741,
    "All medical Wikipedia articles with anatomy diagrams and photos."),
  z("wikem","med","WikEM emergency medicine","other","wikem_en_all_nopic_2026-07.zim",331,
    "The ER doctor's quick reference: workups, drug doses, procedures, decision rules.",{kits:["prep"]}),
  z("medline","med","MedlinePlus (US National Library of Medicine)","zimit","medlineplus.gov_en_all_2025-01.zim",1843,
    "Plain-language health topics, drug information, medical tests and an illustrated encyclopedia."),
  z("nhs-meds","med","NHS medicines A–Z","zimit","nhs.uk_en_medicines_2026-09b.zim",15,
    "What common medicines are for, how to take them, side effects, interactions. 15 MB.",{kits:["pocket"]}),
  z("milmed","med","Military medicine manuals (FAS)","zimit","fas-military-medicine_en_2025-06.zim",78,
    "US military field-medicine manuals: combat casualty care, field sanitation, emergency war surgery."),
  z("zim-med","med","Practical medicine pack","other","zimgit-medicine_en_2024-08.zim",67,
    "Curated offline medical guides for low-resource settings."),
  z("cdc-travel","med","CDC Travelers' Health","zimit","wwwnc.cdc.gov_en_all_2024-11.zim",170,
    "Destination health advice, vaccines, food & water safety, disease info."),
  z("libpath","med","LibrePathology","other","librepathology_en_all_maxi_2026-06.zim",53,
    "Free pathology textbook wiki."),
  z("wikivet","med","WikiVet veterinary","other","wikivet.net_en_all_maxi_2026-07a.zim",54,
    "Veterinary medicine reference for animals and livestock."),

  /* ---- survival & preparedness ---- */
  z("post-disaster","prep","Post-disaster survival library","other","zimgit-post-disaster_en_2024-05.zim",615,
    "Kiwix's curated after-the-disaster library: shelter, sanitation, power, water, first aid, rebuilding.",{star:1,kits:["prep"]}),
  z("water","prep","Water: finding & purifying","other","zimgit-water_en_2024-08.zim",20,
    "How to source, filter, disinfect and store safe drinking water. 20 MB.",{star:1,kits:["pocket","prep"]}),
  z("food","prep","Food preparation & preservation","other","zimgit-food-preparation_en_2025-04.zim",93,
    "Cooking, canning, drying and storing food without modern conveniences.",{kits:["prep"]}),
  z("knots-pack","prep","Knots (illustrated)","other","zimgit-knots_en_2024-08.zim",27,
    "Step-by-step knots for camping, climbing, boating and rescue.",{kits:["pocket"]}),
  z("knots-wp","prep","Knots (Wikipedia set)","wikipedia","wikipedia_en_knots_maxi_2026-07.zim",18,
    "Every knot article on Wikipedia with diagrams. 18 MB."),
  z("readygov","prep","Ready.gov emergency preparedness","zimit","ready.gov_en_all_2026-10.zim",1946,
    "FEMA's official plans for hurricanes, floods, tornadoes, wildfires, power outages and building a kit.",{kits:["prep"]}),
  z("trueprepper","prep","TruePrepper guides","zimit","trueprepper.com_en_all_2026-05.zim",1331,
    "Huge library of practical prepping guides, checklists and gear reviews."),
  z("cd3wd","prep","CD3WD appropriate technology","zimit","cd3wdproject.org_en_all_2025-11.zim",554,
    "The classic 'rebuild civilization' library: farming, water, building, health, small industry."),
  z("appropedia","prep","Appropedia sustainability wiki","other","appropedia_en_all_maxi_2026-02.zim",555,
    "Off-grid solar, water systems, low-tech building and sustainable living projects."),
  z("energypedia","prep","Energypedia (off-grid energy)","other","energypedia_en_all_nopic_2026-06.zim",689,
    "Solar home systems, mini-grids, biogas, cookstoves and other off-grid power know-how."),
  z("armypubs","prep","US Army publications","zimit","armypubs_en_all_2024-12.zim",7885,
    "Field manuals and technical manuals from the US Army publishing directorate: survival, first aid, land navigation, maintenance.",{big:1}),
  z("survivorlib","prep","Survivor Library (complete)","zimit","survivorlibrary.com_en_all_2026-09.zim",209920,
    "Thousands of pre-industrial how-to books: blacksmithing, farming, medicine, chemistry. 205 GB: an external drive project.",{big:1}),
  z("opsec-bible","prep","OPSEC Bible (privacy guides)","zimit","privacydefence.org_en_opsecbible_2026-09.zim",166,
    "Step-by-step operational security and privacy guides. Pairs with the OPSEC tab."),
  z("anon-planet","prep","Anonymous Planet privacy guide","zimit","anonymousplanet.org_en_all_2026-05.zim",27,
    "The Hitchhiker's Guide to Online Anonymity: a deep, defensive privacy reference."),

  /* ---- fix it / how-to ---- */
  z("ifixit","fix","iFixit repair guides","ifixit","ifixit_en_all_2025-12.zim",3379,
    "Tens of thousands of photo-by-photo repair guides for phones, laptops, consoles, cars and appliances.",{star:1,kits:["prep"]}),
  z("se-diy","fix","Home improvement Q&A","stack_exchange","diy.stackexchange.com_en_all_2026-10.zim",1946,
    "Every question and answer from DIY Stack Exchange: wiring, plumbing, HVAC, carpentry."),
  z("se-mech","fix","Motor vehicle repair Q&A","stack_exchange","mechanics.stackexchange.com_en_all_2026-10.zim",326,
    "Car and motorcycle maintenance and repair Q&A."),
  z("se-elec","fix","Electronics Q&A","stack_exchange","electronics.stackexchange.com_en_all_2026-10.zim",4096,
    "Circuit design, repair, power supplies, microcontrollers."),
  z("se-garden","fix","Gardening & landscaping Q&A","stack_exchange","gardening.stackexchange.com_en_all_2026-10.zim",890,
    "Growing food, plant disease, soil, pests."),
  z("se-cook","fix","Cooking Q&A","stack_exchange","cooking.stackexchange.com_en_all_2026-10.zim",227,
    "Food safety, substitutions, techniques, preserving."),
  z("se-outdoors","fix","The Great Outdoors Q&A","stack_exchange","outdoors.stackexchange.com_en_all_2026-10.zim",135,
    "Hiking, camping, survival, navigation, wildlife.",{kits:["prep"]}),
  z("se-wood","fix","Woodworking Q&A","stack_exchange","woodworking.stackexchange.com_en_all_2026-10.zim",102,"Joinery, finishing, tools."),
  z("se-bike","fix","Bicycles Q&A","stack_exchange","bicycles.stackexchange.com_en_all_2026-10.zim",476,"Bike repair and maintenance."),
  z("se-3dp","fix","3D printing Q&A","stack_exchange","3dprinting.stackexchange.com_en_all_2026-10.zim",115,"Printer tuning, slicers, materials."),
  z("se-rpi","fix","Raspberry Pi Q&A","stack_exchange","raspberrypi.stackexchange.com_en_all_2026-10.zim",285,"Everything Raspberry Pi."),
  z("se-sust","fix","Sustainable living Q&A","stack_exchange","sustainability.stackexchange.com_en_all_2026-10.zim",26,"Energy, waste, self-sufficiency."),
  z("se-brew","fix","Homebrewing Q&A","stack_exchange","homebrew.stackexchange.com_en_all_2026-10.zim",36,"Beer, wine, cider, mead."),
  z("se-pets","fix","Pets Q&A","stack_exchange","pets.stackexchange.com_en_all_2026-10.zim",83,"Animal care and health."),
  z("se-money","fix","Personal finance Q&A","stack_exchange","money.stackexchange.com_en_all_2026-10.zim",242,"Budgeting, taxes, investing, credit."),
  z("se-law","fix","Law Q&A","stack_exchange","law.stackexchange.com_en_all_2026-10.zim",179,"Plain-language legal questions."),

  /* ---- learn ---- */
  z("phet","learn","PhET interactive simulations","phet","phet_en_all_2026-08.zim",104,
    "University of Colorado's famous physics, chemistry, math and biology simulations, all playable offline.",{star:1,kits:["student"]}),
  z("lt-k12","learn","LibreTexts K-12","libretexts","libretexts.org_en_k12_2026-01.zim",353,"Open K-12 textbooks across subjects.",{kits:["student"]}),
  z("lt-math","learn","LibreTexts Mathematics","libretexts","libretexts.org_en_math_2026-01.zim",792,"Algebra through differential equations.",{kits:["student"]}),
  z("lt-phys","learn","LibreTexts Physics","libretexts","libretexts.org_en_phys_2026-01.zim",534,"University physics textbooks."),
  z("lt-chem","learn","LibreTexts Chemistry","libretexts","libretexts.org_en_chem_2025-01.zim",2048,"General, organic and analytical chemistry."),
  z("lt-bio","learn","LibreTexts Biology","libretexts","libretexts.org_en_bio_2025-01.zim",2150,"Cell biology, genetics, ecology, anatomy."),
  z("lt-med","learn","LibreTexts Medicine","libretexts","libretexts.org_en_med_2025-01.zim",1126,"Nursing, anatomy & physiology, pharmacology."),
  z("lt-eng","learn","LibreTexts Engineering","libretexts","libretexts.org_en_eng_2025-01.zim",647,"Electrical, mechanical, civil engineering."),
  z("lt-stats","learn","LibreTexts Statistics","libretexts","libretexts.org_en_stats_2026-01.zim",206,"Intro and applied statistics."),
  z("lt-work","learn","LibreTexts Workforce (trades)","libretexts","libretexts.org_en_workforce_2026-01.zim",490,
    "Trade-school texts: welding, HVAC, electrical, construction, automotive."),
  z("wp-math","learn","Wikipedia Mathematics","wikipedia","wikipedia_en_mathematics_nopic_2026-09.zim",349,"Every math article, full text."),
  z("wp-phys","learn","Wikipedia Physics","wikipedia","wikipedia_en_physics_nopic_2026-10.zim",306,"Every physics article, full text."),
  z("wp-chem","learn","Wikipedia Chemistry","wikipedia","wikipedia_en_chemistry_nopic_2026-10.zim",132,"Every chemistry article, full text."),
  z("wp-hist","learn","Wikipedia History","wikipedia","wikipedia_en_history_nopic_2026-10.zim",736,"World and regional history, full text."),
  z("wp-geo","learn","Wikipedia Geography","wikipedia","wikipedia_en_geography_nopic_2026-10.zim",586,"Countries, cities, landforms."),
  z("wp-astro","learn","Wikipedia Astronomy","wikipedia","wikipedia_en_astronomy_nopic_2026-08.zim",385,"Stars, planets, space flight."),
  z("wp-molcell","learn","Wikipedia Molecular & cell biology","wikipedia","wikipedia_en_molcell_nopic_2026-10.zim",339,"Genetics, proteins, cells."),
  z("crashcourse","learn","CrashCourse video lessons","other","crashcourse_en_all_2026-05.zim",21504,
    "Every CrashCourse series (history, science, economics...) as offline video.",{big:1}),
  z("khan","learn","Khan Academy (full)","other","khanacademy_en_all_2023-03.zim",172032,
    "All of Khan Academy as one 168 GB file. For lighter installs use the Kolibri app (Apps tab) and pick channels.",{big:1}),
  z("fcc","learn","freeCodeCamp curriculum","freecodecamp","freecodecamp_en_all_2026-08.zim",8,
    "Learn to code offline: the full freeCodeCamp JavaScript curriculum. 7.5 MB.",{kits:["student"]}),

  /* ---- tech & code ---- */
  z("dd-python","tech","Python docs (DevDocs)","devdocs","devdocs_en_python_2026-08.zim",4.2,"Python standard-library reference."),
  z("dd-js","tech","JavaScript docs (DevDocs)","devdocs","devdocs_en_javascript_2026-10.zim",2.5,"MDN JavaScript reference."),
  z("dd-html","tech","HTML docs (DevDocs)","devdocs","devdocs_en_html_2026-10.zim",1.6,"MDN HTML reference."),
  z("dd-css","tech","CSS docs (DevDocs)","devdocs","devdocs_en_css_2026-10.zim",2.6,"MDN CSS reference."),
  z("dd-bash","tech","Bash manual (DevDocs)","devdocs","devdocs_en_bash_2026-10.zim",0.6,"GNU Bash reference."),
  z("dd-git","tech","Git docs (DevDocs)","devdocs","devdocs_en_git_2026-10.zim",1.5,"Every git command."),
  z("dd-c","tech","C reference (DevDocs)","devdocs","devdocs_en_c_2026-10.zim",1.3,"C language + standard library."),
  z("dd-cpp","tech","C++ reference (DevDocs)","devdocs","devdocs_en_cpp_2026-10.zim",7.7,"C++ language + STL."),
  z("dd-rust","tech","Rust docs (DevDocs)","devdocs","devdocs_en_rust_2026-10.zim",5.9,"Rust std + book."),
  z("dd-go","tech","Go docs (DevDocs)","devdocs","devdocs_en_go_2026-10.zim",1.6,"Go standard library."),
  z("dd-node","tech","Node.js docs (DevDocs)","devdocs","devdocs_en_node_2026-08.zim",1.4,"Node.js API."),
  z("dd-docker","tech","Docker docs (DevDocs)","devdocs","devdocs_en_docker_2026-10.zim",1.7,"Docker CLI and Compose."),
  z("dd-sqlite","tech","SQLite docs (DevDocs)","devdocs","devdocs_en_sqlite_2026-10.zim",3.3,"SQLite SQL reference."),
  z("dd-man","tech","Linux man pages (DevDocs)","devdocs","devdocs_en_man_2026-10.zim",28,"Linux manual pages."),
  z("archwiki","tech","Arch Wiki","other","archlinux_en_all_maxi_2026-07.zim",34,"The best Linux reference on the internet. 34 MB."),
  z("se-askubuntu","tech","Ask Ubuntu","stack_exchange","askubuntu.com_en_all_2026-06.zim",2662,"Ubuntu and Linux desktop Q&A."),
  z("se-superuser","tech","Super User","stack_exchange","superuser.com_en_all_2026-10.zim",3789,"Windows, hardware and power-user Q&A."),
  z("se-unix","tech","Unix & Linux","stack_exchange","unix.stackexchange.com_en_all_2026-10.zim",1229,"Shell, admin and Linux Q&A."),
  z("se-security","tech","Information Security","stack_exchange","security.stackexchange.com_en_all_2026-10.zim",419,"Defensive security Q&A."),
  z("se-so","tech","Stack Overflow (complete)","stack_exchange","stackoverflow.com_en_all_2026-08.zim",109568,
    "All of Stack Overflow. 107 GB: an external drive project.",{big:1}),
  z("openwrt","tech","OpenWrt router docs","zimit","openwrt.org_en_all_2026-07.zim",496,"Flash, configure and harden routers."),
  z("devhints","tech","Devhints cheat sheets","zimit","devhints.io_en_all_2026-08.zim",3.5,"One-page cheat sheets for hundreds of tools."),

  /* ---- travel & maps ---- */
  z("wikivoyage","maps","Wikivoyage travel guide","wikivoyage","wikivoyage_en_all_nopic_2026-09.zim",260,
    "Every Wikivoyage destination: getting there, getting around, sleeping, eating, staying safe.",{star:1,kits:["pocket","prep"]}),
  z("wikivoyage-maxi","maps","Wikivoyage (with maps & photos)","wikivoyage","wikivoyage_en_all_maxi_2026-09.zim",1024,"Wikivoyage with images and maps."),
  z("map-us","maps","Offline map · United States","maps","maps_en_united-states-of-america_2026-06.zim",15872,
    "OpenStreetMap vector map of the whole USA, zoomable to street level, inside Kiwix.",{kits:["prep"]}),
  z("map-na","maps","Offline map · North America","maps","maps_en_north-america_2026-08.zim",21606,"OpenStreetMap: USA, Canada, Mexico."),
  z("map-ca","maps","Offline map · Canada","maps","maps_en_canada_2026-06.zim",10650,"OpenStreetMap: Canada."),
  z("map-uk","maps","Offline map · United Kingdom","maps","maps_en_united-kingdom_2026-06.zim",1843,"OpenStreetMap: UK."),
  z("map-ca-am","maps","Offline map · Central America","maps","maps_en_central-america_2026-08.zim",1638,"OpenStreetMap: Central America."),
  z("map-eu","maps","Offline map · Europe","maps","maps_en_europe_2026-08.zim",25498,"OpenStreetMap: Europe."),
  z("se-travel","maps","Travel Q&A","stack_exchange","travel.stackexchange.com_en_all_2026-10.zim",441,"Visas, borders, transit."),

  /* ---- books (Project Gutenberg, split by Library of Congress class) ---- */
  z("gb-s","books","Gutenberg · Agriculture & farming","gutenberg","gutenberg_en_lcc-s_2026-03.zim",4301,
    "Every public-domain book on farming, animal husbandry, forestry, hunting and fishing.",{kits:["prep"]}),
  z("gb-t","books","Gutenberg · Technology & crafts","gutenberg","gutenberg_en_lcc-t_2026-03.zim",12595,"Engineering, building, manufacturing, home economics, handicrafts."),
  z("gb-r","books","Gutenberg · Medicine","gutenberg","gutenberg_en_lcc-r_2026-03.zim",1946,"Classic medical, nursing and herbal texts."),
  z("gb-q","books","Gutenberg · Science","gutenberg","gutenberg_en_lcc-q_2026-03.zim",16896,"Math, astronomy, physics, chemistry, geology, botany."),
  z("gb-u","books","Gutenberg · Military science","gutenberg","gutenberg_en_lcc-u_2026-03.zim",1229,"Tactics, fieldcraft and military history."),
  z("gb-v","books","Gutenberg · Naval science & seamanship","gutenberg","gutenberg_en_lcc-v_2026-03.zim",1331,"Navigation, seamanship, shipbuilding."),
  z("gb-pz","books","Gutenberg · Fiction & young readers","gutenberg","gutenberg_en_lcc-pz_2026-03.zim",18842,"Novels, adventure and children's books."),
  z("gb-ps","books","Gutenberg · American literature","gutenberg","gutenberg_en_lcc-ps_2026-03.zim",15258,"Twain, Poe, London, Alcott and more."),
  z("gb-pr","books","Gutenberg · English literature","gutenberg","gutenberg_en_lcc-pr_2026-03.zim",15360,"Shakespeare, Austen, Dickens, Doyle and more."),
  z("gb-l","books","Gutenberg · Education","gutenberg","gutenberg_en_lcc-l_2026-03.zim",600,"Teaching, schools, readers and primers."),
  z("gb-k","books","Gutenberg · Law","gutenberg","gutenberg_en_lcc-k_2026-03.zim",235,"Constitutions, legal classics."),
  z("gb-j","books","Gutenberg · Political science","gutenberg","gutenberg_en_lcc-j_2026-03.zim",436,"Government and political theory."),
  z("gb-m","books","Gutenberg · Music & sheet music","gutenberg","gutenberg_en_lcc-m_2026-03.zim",3789,"Music books and scores."),
  z("gb-all","books","Project Gutenberg (complete)","gutenberg","gutenberg_en_all_2025-11.zim",211046,
    "All 75,000+ English Gutenberg books. 206 GB: an external drive project.",{big:1}),

  /* ---- fun ---- */
  z("xkcd","fun","xkcd","zimit","xkcd.com_en_all_2026-08.zim",431,"Every xkcd comic."),
  z("explainxkcd","fun","Explain xkcd","other","explainxkcd_en_all_maxi_2026-07.zim",147,"What every xkcd means."),
  z("minecraft","fun","Minecraft Wiki","other","minecraft.wiki_en_all_2026-08.zim",1843,"Crafting, mobs, redstone, everything."),
  z("stardew","fun","Stardew Valley Wiki","other","stardewvalleywiki_en_all_2026-07.zim",22,"Crops, gifts, bundles. 22 MB.",{kits:["deck"]}),
  z("terraria","fun","Terraria Wiki","other","terraria.wiki.gg_en_all_2026-07a.zim",1126,"Items, bosses, crafting."),
  z("rimworld","fun","RimWorld Wiki","other","rimworldwiki_en_all_maxi_2026-08.zim",62,"Colony sim reference."),
  z("bulbapedia","fun","Bulbapedia (Pokémon)","other","bulbagarden_en_all_nopic_2026-07a.zim",404,"Every Pokémon, move and game."),
  z("dwarffortress","fun","Dwarf Fortress Wiki","other","dwarffortresswiki_en_all_maxi_2026-05a.zim",109,"The DF reference."),
  z("isaac","fun","Binding of Isaac Wiki","other","bindingofisaacrebirth_en_all_maxi_2026-09.zim",124,"Items, synergies, unlocks."),
  z("balatro","fun","Balatro Wiki","other","balatrowiki_en_all_maxi_2026-09.zim",7,"Jokers, decks, stakes. 7 MB."),
];

/* ===================================================================== APPS
   win: { wg:"winget id" }  → winget.js has url + sha256 (fallback when winget is missing)
        { url, page, sha? }  → direct download / official page
   and: { pkg, fd:true (on F-Droid), play:true (on Play), apk:"direct url", page } */
const fd = (pkg, vc) => `https://f-droid.org/repo/${pkg}_${vc}.apk`;

export const APPS = [
  /* ---- offline readers ---- */
  a("kiwix","read","Kiwix","The offline reader for every ZIM in the Library tab: Wikipedia, WikiMed, iFixit, maps, books. Search and read with zero internet.",{
    star:1, kits:["pocket","prep","deck","student"],
    win:{ url:"https://download.kiwix.org/release/kiwix-desktop/kiwix-desktop_windows_x64_2.5.1.zip", mb:150, v:1, zip:1,
          page:"https://kiwix.org/en/applications/", note:"Kiwix Desktop 2.5.1 (portable zip, opens .zim files)" },
    and:{ pkg:"org.kiwix.kiwixmobile", play:1, mb:225, v:1, apk:"https://download.kiwix.org/release/kiwix-android/org.kiwix.kiwixmobile.standalone-v3.14.1.apk",
          note:"Kiwix 3.14.1 (Play Store, or the standalone APK from kiwix.org)" } }),
  a("kiwix-serve","read","kiwix-serve (share your library)","Turns this PC into a library server: every phone, tablet or Steam Deck on your Wi-Fi can read your ZIMs in a browser.",{
    win:{ url:"https://download.kiwix.org/release/kiwix-tools/kiwix-tools_win-x86_64-3.8.1.zip", mb:17, v:1, zip:1, page:"https://kiwix.org/en/applications/" } }),
  a("kiwixjs","read","Kiwix JS (Windows Store edition)","Lightweight Kiwix reader for Windows with a modern UI.",{ win:{ wg:"Kiwix.KiwixJS" } }),
  a("kolibri","read","Kolibri learning platform","Learning Equality's offline school in a box: Khan Academy, CK-12 and hundreds of curated channels, with progress tracking.",{
    kits:["student"],
    win:{ url:"https://learningequality.org/r/kolibri-windows-setup-latest", page:"https://learningequality.org/download/", note:"Kolibri 0.19.5 installer" },
    and:{ pkg:"org.learningequality.Kolibri", play:1, page:"https://kolibri.readthedocs.io/en/latest/install/android.html" } }),
  a("calibre","read","calibre","The e-book library manager: convert, organize and read EPUB/MOBI/PDF, and send books to readers.",{ win:{ wg:"calibre.calibre" } }),
  a("sumatra","read","SumatraPDF","Tiny, instant PDF/EPUB/comic reader.",{ win:{ wg:"SumatraPDF.SumatraPDF", mb:9 } }),
  a("koreader","read","KOReader","The best e-book reader for Android: EPUB, PDF, DjVu, with great typography and dictionary lookups.",{
    and:{ pkg:"org.koreader.launcher.fdroid", fd:1, mb:28, v:1, apk:fd("org.koreader.launcher.fdroid",119462) } }),
  a("librera","read","Librera Reader","Reads PDF, EPUB, FB2, DjVu, comics; text-to-speech.",{ and:{ pkg:"com.foobnix.pro.pdf.reader", fd:1 } }),
  a("survivalmanual","read","Survival Manual","A full offline survival handbook as an app: water, food, shelter, first aid, navigation. Based on the US Army survival field manual.",{
    star:1, kits:["pocket","prep"], and:{ pkg:"org.ligi.survivalmanual", fd:1, mb:7.7, v:1, apk:fd("org.ligi.survivalmanual",500) } }),

  /* ---- maps & navigation ---- */
  a("organicmaps","nav","Organic Maps","Fast, private offline maps with hiking trails, turn-by-turn navigation and contour lines. Download a state, go anywhere without signal.",{
    star:1, kits:["pocket","prep"], and:{ pkg:"app.organicmaps", fd:1, play:1, mb:60, v:1, apk:fd("app.organicmaps",26092932) } }),
  a("comaps","nav","CoMaps","Community fork of Organic Maps with the same offline maps and navigation.",{
    and:{ pkg:"app.comaps.fdroid", fd:1, mb:67, v:1, apk:fd("app.comaps.fdroid",26100519) } }),
  a("osmand","nav","OsmAnd~","The power-user offline map: topo, contour lines, GPX tracks, nautical and ski maps.",{
    and:{ pkg:"net.osmand.plus", fd:1, play:1, mb:154, v:1, apk:fd("net.osmand.plus",541003) } }),
  a("trailsense","nav","Trail Sense","The survival multitool: compass, backtrack, beacons, sun/moon times, weather from the barometer, flashlight, tide tables. 100% offline.",{
    star:1, kits:["pocket","prep"], and:{ pkg:"com.kylecorry.trail_sense", fd:1, play:1, mb:12, v:1, apk:fd("com.kylecorry.trail_sense",148) } }),
  a("opentracks","nav","OpenTracks","Private GPS track recorder for hikes, runs and rides.",{ and:{ pkg:"de.dennisguse.opentracks", fd:1 } }),
  a("compass","nav","Compass","A clean magnetic + true-north compass.",{ and:{ pkg:"com.bobek.compass", fd:1 } }),
  a("gpxsee","nav","GPXSee","Offline map and GPS-track viewer for Windows: GPX/KML, MBTiles and topo maps.",{ win:{ wg:"tumic0.GPXSee" } }),
  a("qgis","nav","QGIS","Professional mapping (GIS): build your own offline maps.",{ win:{ wg:"OSGeo.QGIS" } }),

  /* ---- security & privacy ---- */
  a("keepassxc","sec","KeePassXC","Offline password manager. Your vault is one encrypted file you control.",{ star:1, win:{ wg:"KeePassXCTeam.KeePassXC", mb:34.2, v:1 } }),
  a("keepassdx","sec","KeePassDX","Opens the same KeePass vault on Android, with autofill and biometrics.",{ star:1, and:{ pkg:"com.kunzisoft.keepass.libre", fd:1, mb:15, v:1, apk:fd("com.kunzisoft.keepass.libre",45500) } }),
  a("bitwarden","sec","Bitwarden","Open-source cloud password manager, synced across devices.",{ win:{ wg:"Bitwarden.Bitwarden", mb:0.7, v:1 }, and:{ pkg:"com.x8bit.bitwarden", play:1 } }),
  a("aegis","sec","Aegis Authenticator","Encrypted 2FA codes with backups you control.",{ and:{ pkg:"com.beemdevelopment.aegis", fd:1, mb:6.6, v:1, apk:fd("com.beemdevelopment.aegis",82) } }),
  a("veracrypt","sec","VeraCrypt","Encrypt drives, USB sticks or a hidden vault file.",{ win:{ wg:"IDRIX.VeraCrypt" } }),
  a("wireguard","sec","WireGuard","The fast, modern VPN protocol. Bring your own server or provider config.",{ win:{ wg:"WireGuard.WireGuard", mb:3 }, and:{ pkg:"com.wireguard.android", play:1 } }),
  a("tailscale","sec","Tailscale","Private mesh network between your own devices: reach home from anywhere.",{ win:{ wg:"Tailscale.Tailscale" }, and:{ pkg:"com.tailscale.ipn", fd:1, play:1, mb:100, v:1 } }),
  a("protonvpn","sec","Proton VPN","Swiss VPN with a real free tier.",{ win:{ wg:"Proton.ProtonVPN" }, and:{ pkg:"ch.protonvpn.android", fd:1, play:1 } }),
  a("mullvad","sec","Mullvad VPN","No-account, no-email VPN.",{ win:{ wg:"MullvadVPN.MullvadVPN", mb:119, v:1 }, and:{ pkg:"net.mullvad.mullvadvpn", fd:1, mb:37, v:1, apk:fd("net.mullvad.mullvadvpn",26129000) } }),
  a("orbot","sec","Orbot (Tor)","Route apps through Tor.",{ and:{ pkg:"org.torproject.android", play:1 } }),
  a("netguard","sec","NetGuard","No-root firewall: block apps from the internet.",{ and:{ pkg:"eu.faircode.netguard", fd:1 } }),
  a("signal","sec","Signal","End-to-end encrypted messaging and calls.",{ win:{ wg:"OpenWhisperSystems.Signal" }, and:{ pkg:"org.thoughtcrime.securesms", play:1, page:"https://signal.org/android/apk/" } }),
  a("firefox","sec","Firefox","Private, extension-friendly browser.",{ win:{ wg:"Mozilla.Firefox" }, and:{ pkg:"org.mozilla.firefox", play:1 } }),
  a("brave","sec","Brave","Chromium browser with built-in ad/tracker blocking.",{ win:{ wg:"Brave.Brave" }, and:{ pkg:"com.brave.browser", play:1 } }),
  a("malwarebytes","sec","Malwarebytes","Second-opinion malware scanner.",{ win:{ wg:"Malwarebytes.Malwarebytes" } }),
  a("bleachbit","sec","BleachBit","Wipe caches, logs and free space.",{ win:{ wg:"BleachBit.BleachBit" } }),

  /* ---- files, sync & USB ---- */
  a("localsend","files","LocalSend","AirDrop for everything: send files between Windows, Android and anything else on the same Wi-Fi. No internet needed.",{
    star:1, kits:["pocket","deck"], win:{ wg:"LocalSend.LocalSend" }, and:{ pkg:"org.localsend.localsend_app", fd:1, play:1, mb:44, v:1, apk:fd("org.localsend.localsend_app",643) } }),
  a("syncthing","files","Syncthing","Keep folders in sync between your devices directly, with no cloud involved.",{ win:{ wg:"Syncthing.Syncthing", mb:11.4, v:1 }, and:{ pkg:"com.github.catfriend1.syncthingandroid", fd:1, play:1 } }),
  a("kdeconnect","files","KDE Connect","Phone ↔ PC: shared clipboard, files, notifications, remote control.",{ and:{ pkg:"org.kde.kdeconnect_tp", fd:1, mb:6.8, v:1, apk:fd("org.kde.kdeconnect_tp",13600) } }),
  a("materialfiles","files","Material Files","Clean open-source file manager with SMB, FTP and root support.",{ and:{ pkg:"me.zhanghai.android.files", fd:1, mb:10, v:1, apk:fd("me.zhanghai.android.files",40) } }),
  a("7zip","files","7-Zip","Opens every archive format.",{ win:{ wg:"7zip.7zip", mb:1.6 } }),
  a("everything","files","Everything","Instant whole-PC file search.",{ star:1, kits:["deck"], win:{ wg:"voidtools.Everything" } }),
  a("windirstat","files","WinDirStat","See what's eating your disk.",{ win:{ wg:"WinDirStat.WinDirStat" } }),
  a("qbittorrent","files","qBittorrent","Ad-free torrent client. Kiwix publishes a torrent for every ZIM, which is the fastest way to grab the big ones.",{ win:{ wg:"qBittorrent.qBittorrent" } }),
  a("rufus","files","Rufus","Make bootable USB drives (Windows, Linux, SteamOS recovery).",{ win:{ wg:"Rufus.Rufus", mb:1.9, v:1 } }),
  a("ventoy","files","Ventoy","One USB stick, many ISOs: just copy them on and pick at boot.",{ win:{ wg:"Ventoy.Ventoy", mb:15.9, v:1 } }),
  a("termux","files","Termux","A real Linux terminal on Android: ssh, python, git, rsync.",{ and:{ pkg:"com.termux", fd:1, page:"https://github.com/termux/termux-app/releases" } }),
  a("appmanager","files","App Manager","See and control every app's permissions, trackers and activities.",{ and:{ pkg:"io.github.muntashirakon.AppManager", fd:1 } }),

  /* ---- notes, office & study ---- */
  a("obsidian","notes","Obsidian","Markdown notes that live as plain files on your device.",{ win:{ wg:"Obsidian.Obsidian" }, and:{ pkg:"md.obsidian", play:1 } }),
  a("joplin","notes","Joplin","Open-source notes and to-dos with end-to-end-encrypted sync.",{ win:{ wg:"Joplin.Joplin", mb:344, v:1 }, and:{ pkg:"net.cozic.joplin", fd:1, play:1, mb:147, v:1 } }),
  a("logseq","notes","Logseq","Outliner and knowledge graph.",{ win:{ wg:"Logseq.Logseq" } }),
  a("markor","notes","Markor","Lightweight Markdown and to-do.txt editor.",{ and:{ pkg:"net.gsantner.markor", fd:1, mb:11, v:1, apk:fd("net.gsantner.markor",163) } }),
  a("fossifynotes","notes","Fossify Notes","Simple offline notes and checklists.",{ and:{ pkg:"org.fossify.notes", fd:1 } }),
  a("libreoffice","notes","LibreOffice","Full office suite: documents, spreadsheets, slides.",{ win:{ wg:"TheDocumentFoundation.LibreOffice" } }),
  a("notepadpp","notes","Notepad++","The classic fast text/code editor.",{ win:{ wg:"Notepad++.Notepad++" } }),
  a("anki","notes","Anki","Flashcards with spaced repetition: memorize anything.",{ kits:["student"], win:{ wg:"Anki.Anki", mb:192, v:1 }, and:{ pkg:"com.ichi2.anki", fd:1, play:1, mb:106, v:1 } }),
  a("thunderbird","notes","Thunderbird","Email with offline mailboxes.",{ win:{ wg:"Mozilla.Thunderbird" } }),
  a("unitconv","notes","Unit Converter Ultimate","Every unit and currency, offline.",{ and:{ pkg:"com.physphil.android.unitconverterultimate", fd:1, mb:3.3, v:1, apk:fd("com.physphil.android.unitconverterultimate",50703) } }),

  /* ---- media ---- */
  a("vlc","media","VLC","Plays everything, including the videos in CrashCourse ZIMs.",{ kits:["deck"], win:{ wg:"VideoLAN.VLC" }, and:{ pkg:"org.videolan.vlc", fd:1, play:1, mb:47, v:1, apk:fd("org.videolan.vlc",13070206) } }),
  a("kodi","media","Kodi","Home-theater media center for your own library.",{ win:{ wg:"XBMCFoundation.Kodi" }, and:{ pkg:"org.xbmc.kodi", fd:1, play:1 } }),
  a("newpipe","media","NewPipe","Ad-free YouTube that downloads videos for offline viewing.",{ and:{ pkg:"org.schabi.newpipe", fd:1, mb:10, v:1, apk:fd("org.schabi.newpipe",1015) } }),
  a("antennapod","media","AntennaPod","Podcasts, downloaded for offline listening.",{ and:{ pkg:"de.danoeh.antennapod", fd:1, play:1, mb:16, v:1, apk:fd("de.danoeh.antennapod",3120395) } }),
  a("audacity","media","Audacity","Record and edit audio.",{ win:{ wg:"Audacity.Audacity" } }),
  a("obs","media","OBS Studio","Record or stream your screen.",{ win:{ wg:"OBSProject.OBSStudio" } }),
  a("gimp","media","GIMP","Photo editing.",{ win:{ wg:"GIMP.GIMP.3" } }),
  a("inkscape","media","Inkscape","Vector drawing.",{ win:{ wg:"Inkscape.Inkscape" } }),

  /* ---- games & handheld ---- */
  a("playnite","games","Playnite","One console-style launcher for Steam, Epic, GOG, emulators and everything else, with a controller-friendly fullscreen mode.",{
    star:1, kits:["deck"], win:{ wg:"Playnite.Playnite", mb:148, v:1 } }),
  a("handheldcompanion","games","Handheld Companion","For Windows handhelds (ROG Ally, Legion Go, Steam Deck on Windows): gyro, TDP, controller remapping and a quick overlay.",{
    star:1, kits:["deck"], win:{ wg:"BenjaminLSR.HandheldCompanion", mb:43.6, v:1 } }),
  a("steam","games","Steam","Valve's store and Big Picture mode.",{ win:{ wg:"Valve.Steam", mb:2 } }),
  a("heroic","games","Heroic Games Launcher","Epic, GOG and Amazon games in one open launcher.",{ win:{ wg:"HeroicGamesLauncher.HeroicGamesLauncher" } }),
  a("retroarch","games","RetroArch","All-in-one emulator front end for dozens of classic consoles. Bring your own legally dumped games.",{
    kits:["deck"], win:{ wg:"Libretro.RetroArch" }, and:{ pkg:"com.retroarch", fd:1, play:1, mb:29, v:1, apk:fd("com.retroarch",1597175267) } }),
  a("lemuroid","games","Lemuroid","The easiest retro emulator for Android: point it at your ROM folder and play.",{ star:1, and:{ pkg:"com.swordfish.lemuroid", fd:1, play:1, mb:11, v:1, apk:fd("com.swordfish.lemuroid",252) } }),
  a("ppsspp","games","PPSSPP","PSP emulator.",{ win:{ wg:"PPSSPPTeam.PPSSPP" }, and:{ pkg:"org.ppsspp.ppsspp", fd:1, play:1, mb:39, v:1, apk:fd("org.ppsspp.ppsspp",119030000) } }),
  a("duckstation","games","DuckStation","PlayStation 1 emulator.",{ win:{ wg:"Stenzek.DuckStation" }, and:{ pkg:"com.github.stenzek.duckstation", play:1 } }),
  a("pcsx2","games","PCSX2","PlayStation 2 emulator.",{ win:{ wg:"PCSX2Team.PCSX2", mb:44.6, v:1 } }),
  a("dolphin","games","Dolphin","GameCube and Wii emulator.",{ win:{ page:"https://dolphin-emu.org/download/", note:"Dolphin ships rolling releases from its site" }, and:{ pkg:"org.dolphinemu.dolphinemu", fd:1, play:1, mb:19, v:1, apk:fd("org.dolphinemu.dolphinemu",42460) } }),
  a("mgba","games","mGBA","Game Boy / Color / Advance emulator.",{ win:{ wg:"JeffreyPfau.mGBA" } }),
  a("melonds","games","melonDS","Nintendo DS emulator.",{ win:{ wg:"melonDS.melonDS" } }),
  a("cemu","games","Cemu","Wii U emulator.",{ win:{ wg:"Cemu.Cemu" } }),
  a("xemu","games","xemu","Original Xbox emulator.",{ win:{ wg:"xemu-project.xemu" } }),
  a("scummvm","games","ScummVM","Classic point-and-click adventures. Free legal games like Beneath a Steel Sky are on scummvm.org.",{ win:{ wg:"ScummVM.ScummVM" }, and:{ pkg:"org.scummvm.scummvm", play:1 } }),

  /* ---- radio & off-grid comms ---- */
  a("meshtastic","radio","Meshtastic","Text over cheap LoRa radios: miles of off-grid, no-cell, encrypted messaging. Pairs with a $30 node.",{
    star:1, kits:["prep","comms"], win:{ page:"https://client.meshtastic.org", note:"Web client (Chrome/Edge talks to the radio over USB or Bluetooth)" },
    and:{ pkg:"com.geeksville.mesh", fd:1, play:1, mb:42, v:1, apk:fd("com.geeksville.mesh",29322440) } }),
  a("briar","radio","Briar","Messenger that works over Bluetooth and Wi-Fi with no internet at all, or via Tor when online.",{
    star:1, kits:["prep","comms"], and:{ pkg:"org.briarproject.briar.android", fd:1, play:1, mb:48, v:1, apk:fd("org.briarproject.briar.android",10522) } }),
  a("sdrpp","radio","SDR++","Software-defined radio receiver for RTL-SDR and friends: listen to weather, aircraft, ham bands.",{ kits:["comms"], win:{ wg:"AlexandreRouma.SDRPlusPlus", mb:6.2, v:1 } }),
  a("rfanalyzer","radio","RF Analyzer","Spectrum analyzer for RTL-SDR/HackRF dongles on Android.",{ and:{ pkg:"com.mantz_it.rfanalyzer", fd:1 } }),
  a("wsjtx","radio","WSJT-X","FT8/FT4 weak-signal digital modes for ham radio.",{ kits:["comms"], win:{ wg:"JoeTaylor.WSJT-X" } }),
  a("js8call","radio","JS8Call","Keyboard-to-keyboard messaging over HF ham radio that works in terrible conditions.",{ kits:["comms"], win:{ wg:"JS8Call-improved.JS8Call-improved" } }),
  a("fldigi","radio","fldigi","Digital modes (PSK, RTTY, Olivia) for ham radio.",{ win:{ wg:"w1hkj.fldigi" } }),
  a("winlink","radio","Winlink Express","Email over radio: the emergency-comms standard.",{ kits:["comms"], win:{ wg:"Winlink.WinlinkExpress" } }),
  a("chirp","radio","CHIRP","Program frequencies into Baofeng and 100+ other handheld radios.",{ kits:["comms"], win:{ page:"https://chirpmyradio.com/projects/chirp/wiki/Download", note:"Official daily builds" } }),

  /* ---- system ---- */
  a("powertoys","sys","PowerToys","Microsoft's power-user toolkit: FancyZones, PowerRename, Color Picker, Run.",{ win:{ wg:"Microsoft.PowerToys", mb:283, v:1 } }),
  a("hwinfo","sys","HWiNFO","Every sensor and spec on your machine.",{ win:{ wg:"REALiX.HWiNFO" } }),
  a("crystaldiskinfo","sys","CrystalDiskInfo","Drive health (SMART) before it fails.",{ win:{ wg:"CrystalDewWorld.CrystalDiskInfo" } }),
  a("flashlight","sys","Material Flashlight","Flashlight with SOS strobe.",{ and:{ pkg:"co.garmax.materialflashlight", fd:1 } }),
  a("breezy","sys","Breezy Weather","Detailed weather with alerts, many free sources.",{ and:{ pkg:"org.breezyweather", fd:1 } }),
  a("catima","sys","Catima","Loyalty cards and tickets, offline.",{ and:{ pkg:"me.hackerchick.catima", fd:1 } }),
];

/* ===================================================================== LOCAL AI */
export const AI = [
  a("ollama","airun","Ollama","Runs AI models locally on your PC. T.U.R.D. talks to it to pull the models below, and the Assistant can use it as an offline brain.",{
    star:1, kits:["ai"], win:{ wg:"Ollama.Ollama", mb:1516, v:1 } }),
  a("lmstudio","airun","LM Studio","Point-and-click app to discover, download and chat with local models.",{ win:{ wg:"ElementLabs.LMStudio" } }),
  a("jan","airun","Jan","Open-source ChatGPT-style app that runs 100% offline.",{ win:{ wg:"Jan.Jan", mb:534, v:1 } }),
  a("gpt4all","airun","GPT4All","Private local chat with your own documents (LocalDocs).",{ win:{ wg:"nomic.gpt4all" } }),
  a("llamafile","airun","llamafile","A model + runtime in a single file: double-click to chat. No install.",{ win:{ wg:"Mozilla.llamafile", mb:351, v:1 } }),
  a("pocketpal","airun","PocketPal AI","Chat with small models fully on your phone. Download models inside the app or load the GGUFs below.",{
    star:1, kits:["ai"], and:{ pkg:"com.pocketpalai", play:1, mb:231, v:1, page:"https://github.com/a-ghorbani/pocketpal-ai/releases" } }),
  a("edgegallery","airun","Google AI Edge Gallery","Google's on-device AI showcase: chat, ask about images, transcribe audio, all offline.",{
    and:{ pkg:"com.google.ai.edge.gallery", play:1, mb:57.6, v:1, apk:"https://github.com/google-ai-edge/gallery/releases/download/1.0.20/ai-edge-gallery.apk" } }),
  a("maid","airun","Maid","Open-source local-model chat for Android (GGUF).",{ and:{ pkg:"com.danemadsen.maid", fd:1, mb:22, v:1, apk:fd("com.danemadsen.maid",22532) } }),
];

// Ollama models (Windows, through the Ollama app) — sizes from ollama.com/library.
const om = (tag, name, mb, ram, desc, o={}) => ({ id:"ol-"+tag.replace(/[:.]/g,"-"), cat:"model", kind:"ollama", name, ollama:tag, mb, v:1, ram, desc,
  src:"ollama.com", win:{ ollama:tag }, ...o });
// GGUF files (Android apps / any runner) — size + SHA-256 from the Hugging Face API.
const gg = (id, name, repo, file, mb, ram, desc, o={}) => ({ id, cat:"model", kind:"gguf", name, mb, v:1, ram, desc,
  hf:{ repo, file, url:`https://huggingface.co/${repo}/resolve/main/${file}` }, src:"huggingface.co", both:true, ...o });

export const MODELS = [
  om("gemma3:270m","Gemma 3 · 270M",292,1,"Google's tiniest model. Fast on anything, good for simple rewrites and classification."),
  om("gemma3:1b","Gemma 3 · 1B",806,2,"Small, quick, surprisingly capable at chat and summaries."),
  om("llama3.2:1b","Llama 3.2 · 1B",1331,2,"Meta's small model, good at instructions and tool use."),
  om("qwen3:1.7b","Qwen 3 · 1.7B",1434,3,"Reasoning ('thinking') model that runs on a laptop iGPU."),
  om("llama3.2:3b","Llama 3.2 · 3B",2048,4,"Best all-round pick for 8 GB machines.",{star:1,kits:["ai"]}),
  om("qwen3:4b","Qwen 3 · 4B",2560,5,"Strong reasoning and coding for its size; 256K context.",{star:1}),
  om("phi4-mini","Phi-4 mini · 3.8B",2560,5,"Microsoft's small model, great at math and logic."),
  om("gemma3:4b","Gemma 3 · 4B",3482,6,"Sees images too: ask about photos and screenshots."),
  om("qwen3.5:4b","Qwen 3.5 · 4B",3482,6,"Newest Qwen: text + images, tools, thinking."),
  om("qwen3:8b","Qwen 3 · 8B",5325,10,"Big-model quality for 16 GB PCs."),
  gg("gguf-gemma3-1b","Gemma 3 1B (GGUF Q4_K_M)","ggml-org/gemma-3-1b-it-GGUF","gemma-3-1b-it-Q4_K_M.gguf",769,2,
    "Runs on almost any phone. Load it in PocketPal or Maid.",{kits:["ai"]}),
  gg("gguf-qwen35-2b","Qwen 3.5 2B (GGUF Q4_K_M)","unsloth/Qwen3.5-2B-GGUF","Qwen3.5-2B-Q4_K_M.gguf",1222,3,"Newest small Qwen, a good phone pick."),
  gg("gguf-llama32-3b","Llama 3.2 3B (GGUF Q4_K_M)","bartowski/Llama-3.2-3B-Instruct-GGUF","Llama-3.2-3B-Instruct-Q4_K_M.gguf",1926,4,
    "Best quality for 6–8 GB phones.",{star:1}),
  gg("gguf-qwen3-4b","Qwen 3 4B (GGUF Q4_K_M)","unsloth/Qwen3-4B-GGUF","Qwen3-4B-Q4_K_M.gguf",2382,5,"Reasoning model for flagship phones."),
];

/* ===================================================================== KITS */
export const KITS = [
  { id:"pocket", name:"Pocket kit", blurb:"The essentials that fit on any phone: top Wikipedia, medical, travel, water, knots, plus the apps that read and map it all." },
  { id:"prep", name:"Prepper kit", blurb:"Everything for when the grid is down: all of Wikipedia, WikiMed, ER medicine, Ready.gov, iFixit, farming books, US map, mesh messaging." },
  { id:"deck", name:"Handheld / Steam Deck kit", blurb:"For Windows handhelds and small PCs: Playnite, Handheld Companion, emulators, LocalSend, offline Wikipedia, game wikis." },
  { id:"student", name:"Student kit", blurb:"A school with no internet: PhET labs, LibreTexts, Simple Wikipedia, Kolibri, Anki, freeCodeCamp." },
  { id:"comms", name:"Off-grid comms kit", blurb:"Meshtastic, Briar, SDR++, WSJT-X, JS8Call, Winlink, CHIRP. Pairs with the radio tables in the Field Guide." },
  { id:"ai", name:"Private AI kit", blurb:"A local AI that never phones home: Ollama + Llama 3.2 on PC, PocketPal + Gemma on Android." },
];

export const ALL = [...LIBRARY, ...APPS, ...AI, ...MODELS];
export const byId = id => ALL.find(x=>x.id===id);
