// ===========================================================================
// FIELD GUIDE: quick reference built into T.U.R.D., so it works with no
// internet and nothing downloaded. Medical steps follow current American Red
// Cross / AHA lay-rescuer guidance; water numbers follow CDC/EPA; radio tables
// are FCC channel plans. It is a reference, not training: call 911 (or your
// local number) first.
// ===========================================================================

/* ------------------------------------------------------------ content helpers */
const steps = (...s) => `<ol class="xg-steps">${s.map(x=>`<li>${x}</li>`).join("")}</ol>`;
const dont = (...s) => `<div class="xg-dont"><b>Don't</b><ul>${s.map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
const call = t => `<div class="xg-call">${t}</div>`;
const table = (head, rows, cls="") => `<table class="xg-t ${cls}"><thead><tr>${head.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${
  rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

/* ===================================================================== FIRST AID */
const FIRST_AID = [
  { id:"fa-check", t:"Emergency: check · call · care", k:"start here", html:
    steps("<b>Check the scene</b> is safe for you (traffic, fire, wires, water). Put on gloves if you have them.",
      "<b>Check the person</b>: tap shoulders and shout. Look for normal breathing for no more than 10 seconds.",
      "<b>Call 911</b> (or have someone call) and send someone for an <b>AED</b>. Put the phone on speaker; the dispatcher will coach you.",
      "Not breathing or only gasping → start <b>CPR</b>. Breathing but unresponsive → <b>recovery position</b> (on their side, top knee bent, head tilted back).",
      "Severe bleeding → <b>direct pressure</b> now; it outranks almost everything else.")
    + call("US 911 · EU 112 · UK 999 · AU 000 · Poison Help 1-800-222-1222 · Crisis line 988") },
  { id:"fa-cpr", t:"CPR: adult, child, infant", k:"cardiac arrest", html:
    steps("Person on their back on a firm surface. Kneel beside the chest.",
      "<b>Adult</b>: heel of one hand on the center of the chest (lower half of the breastbone), other hand on top, arms straight.",
      "Push <b>hard and fast</b>: at least <b>2 in (5 cm)</b> deep, <b>100–120 per minute</b> (the beat of 'Stayin' Alive'). Let the chest fully recoil.",
      "Trained and willing: <b>30 compressions, then 2 breaths</b> (tilt head, lift chin, pinch nose, 1-second breaths that make the chest rise). Otherwise do <b>hands-only CPR</b> without stopping.",
      "<b>AED</b> arrives → turn it on and do exactly what it says. Resume compressions right after a shock.",
      "Keep going until help takes over, the person starts breathing, or you're physically unable.")
    + table(["","Hands","Depth","Ratio (1 rescuer)"],[
      ["Adult","2 hands","2–2.4 in (5–6 cm)","30:2"],
      ["Child (1 yr–puberty)","1 or 2 hands","about 2 in (5 cm)","30:2"],
      ["Infant (&lt;1 yr)","2 fingers or 2 thumbs","about 1.5 in (4 cm)","30:2"]])
    + `<p class="xg-p">Use the <b>metronome</b> in Tools to keep pace at 110/min.</p>` },
  { id:"fa-choke", t:"Choking", k:"can't breathe, cough or speak", html:
    `<p class="xg-p">If they can cough forcefully, let them cough. If they can't cough, speak or breathe:</p>`
    + steps("<b>Adult/child</b>: stand behind, lean them forward, give <b>5 firm back blows</b> between the shoulder blades with the heel of your hand.",
      "Then <b>5 abdominal thrusts</b>: fist just above the navel, other hand over it, quick inward-and-up thrusts.",
      "Alternate 5 and 5 until the object comes out or they become unresponsive. If unresponsive, call 911 and start CPR; look in the mouth for the object before breaths.",
      "<b>Infant</b>: face-down along your forearm, head lower than chest, <b>5 back blows</b>, then turn face-up and give <b>5 chest thrusts</b> with 2 fingers on the breastbone.",
      "Pregnant or very large person: <b>chest thrusts</b> instead of abdominal thrusts.",
      "Alone? Thrust your own abdomen against a chair back or counter edge.") },
  { id:"fa-bleed", t:"Severe bleeding & tourniquets", k:"stop the bleed", html:
    steps("Call 911. Gloves or any barrier if available.",
      "<b>Direct pressure</b>: press firmly with a cloth or gauze, both hands, body weight. Don't peek; add layers on top.",
      "Deep wound in the leg/arm, armpit or groin and it keeps pouring → <b>pack the wound</b> tightly with gauze/cloth, then press hard for at least 3 minutes.",
      "<b>Arm or leg bleeding that pressure can't stop → tourniquet</b>: 2–3 in (5–7 cm) above the wound, never on a joint. Tighten the windlass until bleeding <b>stops</b> (it will hurt), lock it, and <b>note the time</b>.",
      "Keep them warm and lying down. Watch for shock.")
    + dont("Loosen or remove a tourniquet once it's on; leave that to medical staff.","Use a thin cord or wire as a tourniquet; improvised ones need a 1–2 in wide band and a rigid windlass.") },
  { id:"fa-shock", t:"Shock", k:"pale, cold, fast pulse", html:
    `<p class="xg-p">Signs: pale/gray, cold clammy skin, fast weak pulse, fast breathing, confusion, thirst.</p>`
    + steps("Call 911. Treat the cause (stop bleeding).","Lay them flat; keep them warm with a blanket under and over.","Nothing to eat or drink.","Reassure them and monitor breathing; be ready for CPR.") },
  { id:"fa-burn", t:"Burns", k:"heat, chemical, electrical", html:
    steps("Stop the burning: remove from source; for electrical burns <b>cut the power first</b>.",
      "<b>Cool with cool running water for at least 10 minutes</b> (up to 20). Remove rings and tight items before swelling.",
      "Cover loosely with clean plastic wrap or a non-stick dressing.",
      "Chemical burn: brush off dry chemical, then flush with lots of water for 20 minutes.",
      "Call 911 for burns larger than the person's palm, on the face/hands/feet/groin/joints, all-the-way-through (white/charred) burns, electrical or chemical burns, or any burn on a child or older adult.")
    + dont("Ice, butter, oil, toothpaste.","Pop blisters.","Peel off clothing stuck to the burn.") },
  { id:"fa-heat", t:"Heat exhaustion & heat stroke", k:"hot weather", html:
    table(["","Signs","Do"],[
      ["Heat exhaustion","Heavy sweating, cool pale skin, cramps, headache, nausea, dizziness","Move to shade/AC, loosen clothing, cool wet cloths, sip water or sports drink. Better in 1 hour or call 911."],
      ["<b>Heat stroke</b> (emergency)","Very hot skin (104 °F / 40 °C+), confusion, slurred speech, may stop sweating, seizures, collapse","<b>Call 911.</b> Cool fast: cold-water immersion up to the neck is best; otherwise soak with cold water and fan, ice packs to neck, armpits, groin. Keep cooling until help arrives."]]) },
  { id:"fa-cold", t:"Hypothermia & frostbite", k:"cold weather", html:
    `<p class="xg-p"><b>Hypothermia</b>: shivering, fumbling, mumbling, confusion, drowsiness. Severe: shivering stops.</p>`
    + steps("Call 911 if severe. Move them out of the cold and wind; handle gently.",
      "Remove wet clothing; wrap in dry blankets, sleeping bag, foil blanket, including head and neck. Insulate from the ground.",
      "Warm the <b>core first</b> (chest, neck, armpits, groin) with warm (not hot) packs or skin-to-skin.",
      "Only if fully alert: warm, sweet, non-alcoholic drinks.")
    + `<p class="xg-p"><b>Frostbite</b>: white/gray waxy numb skin. Get to warmth, rewarm in warm (not hot, ~100–104 °F / 37–40 °C) water for 20–30 min. <b>Don't</b> rub it or rewarm if it could refreeze.</p>` },
  { id:"fa-stroke", t:"Stroke: BE FAST", k:"brain attack", html:
    table(["","Check"],[
      ["<b>B</b>alance","Sudden loss of balance or coordination?"],["<b>E</b>yes","Sudden vision loss or double vision?"],
      ["<b>F</b>ace","Ask them to smile. Does one side droop?"],["<b>A</b>rms","Raise both arms. Does one drift down?"],
      ["<b>S</b>peech","Slurred or strange? Can they repeat a simple sentence?"],["<b>T</b>ime","<b>Call 911 now.</b> Note when symptoms started."]])
    + dont("Give food, drink or medication.","Let them 'sleep it off'.") },
  { id:"fa-heart", t:"Heart attack", k:"chest pain", html:
    `<p class="xg-p">Chest pressure, squeezing or pain (may spread to arm, jaw, back); shortness of breath; cold sweat; nausea. Women, diabetics and older adults often have vague symptoms.</p>`
    + steps("<b>Call 911</b> immediately; don't drive them yourself unless there is no other option.",
      "Keep them resting, seated, loosen tight clothing.",
      "If they aren't allergic, aren't on blood thinners and the dispatcher agrees, have them <b>chew one adult aspirin (325 mg)</b> or 2–4 low-dose (81 mg).",
      "If they become unresponsive and aren't breathing normally: <b>CPR + AED</b>.") },
  { id:"fa-anaph", t:"Severe allergic reaction", k:"anaphylaxis", html:
    `<p class="xg-p">Swelling of lips/tongue/throat, wheeze, hives, vomiting, faintness, after food, sting or medicine.</p>`
    + steps("Use their <b>epinephrine auto-injector</b> (EpiPen etc.) into the outer thigh, through clothing if needed. Hold for the time printed on it.",
      "<b>Call 911</b>, even if they improve.",
      "Lying down with legs raised (or sitting up if breathing is hard). Don't let them stand or walk.",
      "No improvement after 5–15 minutes and a second injector is available → give it.") },
  { id:"fa-seizure", t:"Seizure", k:"convulsions", html:
    steps("Time it. Clear the area; cushion the head.","Turn them on their side once the jerking allows.","Stay until fully aware.",
      "Call 911 if it lasts more than 5 minutes, repeats, it's their first ever, they're injured, pregnant, diabetic, in water, or don't wake up.")
    + dont("Hold them down.","Put anything in their mouth.") },
  { id:"fa-sugar", t:"Low blood sugar", k:"diabetic emergency", html:
    `<p class="xg-p">Shaky, sweaty, pale, confused, irritable, in someone with diabetes.</p>`
    + steps("If they can swallow: <b>15 g of fast sugar</b>: 4 oz (½ cup) juice or regular soda, 4 glucose tablets, or 1 tbsp sugar/honey.",
      "Wait 15 minutes; if still symptomatic, repeat (the 'rule of 15').","Then a snack with protein/starch.",
      "Can't swallow safely or unresponsive → <b>call 911</b>, nothing by mouth; use their glucagon kit if available.") },
  { id:"fa-poison", t:"Poisoning & overdose", k:"swallowed, inhaled, opioid", html:
    steps("<b>Poison Help: 1-800-222-1222</b> (US, 24/7, free) for swallowed chemicals, medicines, plants, bites. Call 911 if they collapse, seize or can't breathe.",
      "Inhaled (smoke, CO, fumes): get them into fresh air without becoming a victim yourself.",
      "<b>Suspected opioid overdose</b> (unresponsive, tiny pupils, slow or no breathing): call 911, give <b>naloxone (Narcan)</b> nasal spray, support breathing, give another dose after 2–3 minutes if no response.")
    + dont("Make them vomit unless Poison Help tells you to.") },
  { id:"fa-bone", t:"Broken bones, sprains, head injury", k:"injuries", html:
    steps("Don't move the person if a neck or back injury is possible: keep the head still in line with the body and call 911.",
      "Splint a suspected break in the position you found it: pad it and immobilize the joints above and below (rolled magazine, sticks, folded blanket).",
      "Sprains: <b>rest, ice</b> (20 min on, wrapped), <b>compression, elevation</b>.")
    + `<p class="xg-p"><b>Head injury red flags</b> → 911: passed out, repeated vomiting, worsening headache, confusion, unequal pupils, clear fluid from nose/ears, seizure, drowsiness that won't clear.</p>` },
  { id:"fa-snake", t:"Snakebite", k:"venomous bite", html:
    steps("Move away from the snake. Call 911; get to a hospital (antivenom) fast.","Keep calm and still; keep the bitten limb relaxed, roughly at heart level.","Remove rings, watches, tight clothing before swelling.","Note the time and, from a safe distance, the snake's look (photo if safe).")
    + dont("Tourniquet, cutting, suction, ice, alcohol, or trying to catch the snake.") },
  { id:"fa-misc", t:"Nosebleed, eye injury, dehydration", k:"quick fixes", html:
    `<p class="xg-p"><b>Nosebleed</b>: sit up, lean <b>forward</b>, pinch the soft part of the nose for 10–15 minutes without letting go.</p>
     <p class="xg-p"><b>Chemical in the eye</b>: flush with clean lukewarm water for 15–20 minutes, holding the eye open. Object stuck in the eye: don't remove it; cover both eyes loosely and get care.</p>
     <p class="xg-p"><b>Oral rehydration solution</b> (WHO home recipe) for diarrhea/dehydration: <b>1 liter clean water + 6 level teaspoons sugar + ½ level teaspoon salt</b>. Sip often.</p>` },
];

/* ===================================================================== SURVIVAL */
const SURVIVAL = [
  { id:"sv-3s", t:"Rule of 3s & priorities", k:"what matters first", html:
    table(["You can survive about","without"],[["3 minutes","air (or with severe bleeding)"],["3 hours","shelter in harsh weather"],["3 days","water"],["3 weeks","food"]])
    + `<p class="xg-p"><b>S.T.O.P.</b>: <b>S</b>top, <b>T</b>hink, <b>O</b>bserve, <b>P</b>lan. Lost? Stay put, make yourself visible, conserve energy. Tell someone your route before any trip.</p>` },
  { id:"sv-water", t:"Making water safe", k:"boil, bleach, filter", html:
    steps("Let cloudy water settle, then pour it through a clean cloth or coffee filter.",
      "<b>Boil</b>: a rolling boil for <b>1 minute</b>; above <b>6,500 ft (2,000 m)</b> boil for <b>3 minutes</b>. Most reliable method.",
      "<b>Bleach</b> (plain, unscented household bleach; check the % on the label): stir, wait <b>30 minutes</b>. It should smell faintly of chlorine; if not, repeat the dose and wait 15 more minutes.",
      "<b>Filter</b>: 0.1–0.2 micron filters (Sawyer, LifeStraw) remove bacteria and protozoa, but not viruses or chemicals. Combine with bleach or boiling for full safety.",
      "<b>Sun (SODIS)</b>: clear PET bottle, clear water, 6 hours in full sun (2 days if cloudy).")
    + table(["Bleach strength","per 1 gallon (3.8 L)","per 1 liter"],[["6%","8 drops (⅛ tsp)","2 drops"],["8.25%","6 drops","2 drops"],["Cloudy/very cold water","double it","double it"]])
    + `<p class="xg-p">Plan <b>1 gallon (4 L) per person per day</b>, at least 3 days stored (2 weeks is better). Emergency sources at home: water heater tank, toilet <i>tank</i> (not bowl), ice cubes, canned food liquid.</p>` },
  { id:"sv-shelter", t:"Shelter & staying warm", k:"exposure", html:
    steps("Get out of wind and wet first; insulation from the ground matters more than a roof (leaves, pine boughs, pack, foam).",
      "Small shelters warm faster. Debris hut: ridgepole, ribs, then 2–3 ft of leaves on top.",
      "Layers: wicking base, insulating middle (wool, fleece, down), wind/waterproof shell. Cotton kills when wet.",
      "Space blanket shiny side in. Share body heat. Eat fat and carbs before sleep.") },
  { id:"sv-fire", t:"Fire", k:"heat, light, signal", html:
    steps("Gather everything before striking: <b>tinder</b> (dry grass, birch bark, cotton + petroleum jelly, dryer lint), <b>kindling</b> (pencil-thin sticks), <b>fuel</b> (wrist-thick and up).",
      "Build a small teepee or log-cabin over the tinder; leave an opening on the windward side.",
      "Light low; feed slowly; blow gently at the base.",
      "Ferro rod: scrape the rod back (pull the rod away) so sparks land in the tinder.",
      "Never run generators, grills or camp stoves indoors: <b>carbon monoxide</b> kills without warning.") },
  { id:"sv-signal", t:"Signaling for rescue", k:"be seen", html:
    `<p class="xg-p">Anything in <b>threes</b> means distress: 3 fires in a triangle, 3 whistle blasts, 3 gunshots, 3 flashes. Use the strobe in Tools for an SOS light.</p>`
    + table(["Ground-to-air symbol","Meaning"],[["<b>V</b>","Require assistance"],["<b>X</b>","Require medical assistance"],["<b>N</b>","No / negative"],["<b>Y</b>","Yes / affirmative"],["<b>→</b>","Proceeding in this direction"]])
    + `<p class="xg-p">Make symbols at least 10 ft (3 m) tall, high contrast. Signal mirror: aim through your V-fingers at the aircraft. A 911 text works in many US areas when calls don't connect.</p>` },
  { id:"sv-nav", t:"Navigation without a compass", k:"find north", html:
    steps("<b>Shadow stick</b>: put a stick upright, mark the shadow tip, wait 15 minutes, mark again. The line from 1st to 2nd mark points roughly <b>east</b>.",
      "<b>Watch method</b> (northern hemisphere): point the hour hand at the sun; halfway between it and 12 is <b>south</b> (use 1 o'clock during daylight saving).",
      "<b>North Star</b>: follow the two outer stars of the Big Dipper's cup up ~5 cup-lengths; Polaris is within 1° of true north.",
      "Southern hemisphere: the Southern Cross's long axis points toward the south celestial pole.",
      "The sun rises roughly east and sets roughly west (exactly only at the equinoxes).")
    + `<p class="xg-p">Phone compass: Tools → <b>Compass</b> (uses the device sensor, no signal needed).</p>` },
  { id:"sv-knots", t:"Six knots worth knowing", k:"rope work", html:
    table(["Knot","Use","How"],[
      ["Bowline","Fixed loop that won't slip (rescue, mooring)","Make a small loop; 'the rabbit comes up the hole, around the tree, back down the hole'."],
      ["Clove hitch","Quick tie to a post or pole","Two turns around the post, second crossing over the first, end tucked under."],
      ["Taut-line hitch","Adjustable tent guy-line","Around the stake, back; two turns inside the loop, one outside; slide to tension."],
      ["Square (reef) knot","Join two ends of the same rope (bandages)","Right over left and under, left over right and under."],
      ["Sheet bend","Join two different ropes","Bight in the thicker rope; thin end up through, around both legs, under itself."],
      ["Trucker's hitch","Cinch a load down tight","Fixed loop mid-line, around the anchor, back through the loop, pull for 3:1, lock with two half hitches."]]) },
  { id:"sv-kit", t:"Go-bag checklist", k:"interactive", list:"gobag" },
  { id:"sv-home", t:"Power outage & home emergencies", k:"at home", html:
    steps("Keep fridge/freezer closed: a full freezer holds ~48 hours, a fridge ~4 hours. When in doubt, throw it out.",
      "Generator: <b>outdoors only, 20 ft (6 m) from windows/doors</b>, never in a garage. Run a battery CO alarm.",
      "Unplug electronics to avoid surge damage when power returns.",
      "Know where your <b>water main, gas shut-off and breaker panel</b> are. Only turn gas off if you smell gas; let the utility turn it back on.",
      "Smell gas? Leave now, don't flip switches, call from outside.") },
  { id:"sv-hazards", t:"Storms, floods, quakes, fire", k:"disaster actions", html:
    table(["Hazard","Do"],[
      ["Tornado","Lowest floor, interior room without windows, cover your head. Mobile home or car → nearest sturdy building."],
      ["Flood","Turn around, don't drown: 6 in of moving water knocks you down, 12 in floats a car. Get to high ground."],
      ["Earthquake","<b>Drop, cover, hold on.</b> Stay inside until shaking stops. Outdoors: away from buildings and lines."],
      ["Wildfire","Leave early. N95 for smoke. Close all windows/vents; wear cotton/wool, not synthetics."],
      ["Hurricane","Know your evacuation zone; leave when told. Fill tub with water; charge batteries."],
      ["Lightning","When thunder roars, go indoors. No shelter: avoid peaks, lone trees, water; crouch on the balls of your feet."],
      ["Winter storm","Stay off roads. In a stuck car: run the engine 10 min/hour with the exhaust pipe clear of snow."]]) },
];

/* ===================================================================== COMMS */
const FRS = [["1","462.5625"],["2","462.5875"],["3","462.6125"],["4","462.6375"],["5","462.6625"],["6","462.6875"],["7","462.7125"],
  ["8","467.5625"],["9","467.5875"],["10","467.6125"],["11","467.6375"],["12","467.6625"],["13","467.6875"],["14","467.7125"],
  ["15","462.5500"],["16","462.5750"],["17","462.6000"],["18","462.6250"],["19","462.6500"],["20","462.6750"],["21","462.7000"],["22","462.7250"]];
const CB = ["26.965","26.975","26.985","27.005","27.015","27.025","27.035","27.055","27.065","27.075","27.085","27.105","27.115","27.125",
  "27.135","27.155","27.165","27.175","27.185","27.205","27.215","27.225","27.255","27.235","27.245","27.265","27.275","27.285","27.295",
  "27.305","27.315","27.325","27.335","27.345","27.355","27.365","27.375","27.385","27.395","27.405"];
const frsPower = ch => { const n=+ch; return n<=7 ? "2 W FRS · 5 W GMRS" : n<=14 ? "0.5 W FRS only" : "2 W FRS · 50 W GMRS"; };
const NATO = "Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu".split(" ");

const COMMS = [
  { id:"cm-key", t:"Key frequencies", k:"emergency & weather", html:
    table(["What","Frequency","Notes"],[
      ["Marine VHF ch 16","156.800 MHz","International distress, safety & calling. Coast Guard monitors."],
      ["Marine VHF ch 9","156.450 MHz","Boater calling channel."],["Marine VHF ch 22A","157.100 MHz","US Coast Guard working channel."],
      ["Aviation emergency","121.500 MHz","Guard frequency, monitored by aircraft and ATC."],
      ["NOAA Weather Radio","162.400 · 162.425 · 162.450 · 162.475 · 162.500 · 162.525 · 162.550 MHz","24/7 US weather + alerts. Receive-only; any weather radio or scanner."],
      ["CB ch 9","27.065 MHz","Emergency / traveler assistance."],["CB ch 19","27.185 MHz","Highway / truckers."],
      ["FRS/GMRS ch 1 & 3","462.5625 / 462.6125 MHz","Common family/neighborhood channels; many prep groups use ch 3 with privacy code off."],
      ["Ham 2 m calling","146.520 MHz FM","National simplex calling frequency (license required to transmit)."],
      ["Ham 70 cm calling","446.000 MHz FM","Simplex calling (license required)."],
      ["Ham HF","7.200 · 14.300 MHz","Common emergency/maritime nets (license required)."]])
    + `<p class="xg-p">Listening is always legal. Transmitting on ham bands needs a license except in a genuine life-threatening emergency.</p>` },
  { id:"cm-frs", t:"FRS / GMRS channels", k:"walkie-talkies, no license (FRS)", html:
    table(["Ch","MHz","Power"], FRS.map(([c,f])=>[c,f,frsPower(c)]), "xg-dense")
    + `<p class="xg-p">FRS needs no license. GMRS (higher power, repeaters) needs an FCC license ($35, 10 yrs, covers your family, no exam). GMRS repeater inputs are 467.550–467.725 MHz.</p>` },
  { id:"cm-murs", t:"MURS channels", k:"no license, VHF", html:
    table(["Ch","MHz","Bandwidth"],[["1","151.820","11.25 kHz"],["2","151.880","11.25 kHz"],["3","151.940","11.25 kHz"],["4","154.570","20 kHz"],["5","154.600","20 kHz"]])
    + `<p class="xg-p">Multi-Use Radio Service: license-free, up to 2 W, external antennas allowed. Good range in open country.</p>` },
  { id:"cm-cb", t:"CB radio channels", k:"40 channels, no license", html:
    table(["Ch","MHz","Ch","MHz"], Array.from({length:20},(_,i)=>[i+1, CB[i], i+21, CB[i+20]]), "xg-dense")
    + `<p class="xg-p">AM 4 W / SSB 12 W PEP. Ch 9 emergency, ch 19 highway. Ch 23–25 are out of order on purpose.</p>` },
  { id:"cm-nato", t:"Phonetic alphabet & numbers", k:"NATO / ICAO", html:
    `<div class="xg-nato">${NATO.map(w=>`<span><b>${w[0]}</b>${w}</span>`).join("")}</div>`
    + `<p class="xg-p">Numbers: ZE-RO, WUN, TOO, TREE, FOW-ER, FIFE, SIX, SEV-EN, AIT, NIN-ER. Say "decimal" for the point.</p>` },
  { id:"cm-pro", t:"Radio procedure", k:"prowords & message format", html:
    table(["Proword","Means"],[["MAYDAY ×3","Life-threatening emergency (vessel/aircraft/person)"],["PAN-PAN ×3","Urgent, not yet life-threatening"],["SECURITÉ ×3","Safety information"],
      ["OVER","My turn is done, your turn"],["OUT","Conversation over (never 'over and out')"],["ROGER","Received and understood"],["WILCO","Will comply"],["SAY AGAIN","Repeat"],["BREAK","Pause / separate parts"],["I SPELL","Spelling follows phonetically"]])
    + `<p class="xg-p"><b>Mayday format</b>: MAYDAY ×3 · THIS IS (name ×3) · position · nature of distress · help needed · number of people · description · OVER.</p>` },
  { id:"cm-q", t:"Common Q-codes", k:"ham shorthand", html:
    table(["Code","Meaning"],[["QTH","My location is"],["QSL","I confirm receipt"],["QRZ","Who is calling me?"],["QRM","Interference (man-made)"],["QRN","Static (natural)"],
      ["QSY","Change frequency"],["QRT","Stop transmitting / going off air"],["QRP","Low power"],["QSO","A contact/conversation"],["QSB","Signal fading"]]) },
  { id:"cm-morse", t:"Morse code", k:"live translator in Tools", morse:true },
];

/* ===================================================================== REFERENCE */
const REFERENCE = [
  { id:"rf-beaufort", t:"Wind (Beaufort scale)", k:"read the wind", html:
    table(["#","mph","What you see"],[
      ["0","&lt;1","Calm, smoke rises straight up"],["1","1–3","Smoke drifts"],["2","4–7","Leaves rustle, wind felt on face"],["3","8–12","Leaves and twigs in constant motion"],
      ["4","13–18","Dust, loose paper, small branches move"],["5","19–24","Small trees sway"],["6","25–31","Large branches move, umbrellas hard"],
      ["7","32–38","Whole trees move, hard to walk"],["8","39–46","Twigs break off"],["9","47–54","Slight structural damage"],
      ["10","55–63","Trees uprooted"],["11","64–72","Widespread damage"],["12","73+","Hurricane force"]], "xg-dense") },
  { id:"rf-scales", t:"Hurricane & tornado scales", k:"Saffir-Simpson · EF", html:
    table(["Hurricane","Wind (mph)","Tornado","Wind (mph)"],[["Cat 1","74–95","EF0","65–85"],["Cat 2","96–110","EF1","86–110"],["Cat 3 (major)","111–129","EF2","111–135"],
      ["Cat 4","130–156","EF3","136–165"],["Cat 5","157+","EF4","166–200"],["","","EF5","200+"]]) },
  { id:"rf-clouds", t:"Reading the sky", k:"weather signs", html:
    table(["Sign","Usually means"],[["High wispy cirrus thickening into a sheet","Rain or snow in 12–24 h"],["Halo around sun or moon","Moisture aloft; precipitation likely soon"],
      ["Towering cumulus by midday","Thunderstorms by afternoon"],["Anvil-topped cumulonimbus","Storm now: lightning, hail, gusts"],
      ["Green sky, sudden calm, roaring sound","Possible tornado: take cover"],["Red sky at night","Usually fair weather coming (mid-latitudes)"],["Falling barometer (&gt;1 hPa/h)","Storm approaching"]]) },
  { id:"rf-numbers", t:"Emergency numbers", k:"by country", html:
    table(["Region","Number"],[["USA / Canada","911 (text 911 where supported)"],["EU + most of world","112"],["UK","999 or 112"],["Australia","000 (112 on mobile)"],["New Zealand","111"],["India","112"],["Mexico","911"],["Japan","110 police · 119 fire/ambulance"],
      ["US Poison Help","1-800-222-1222"],["US Suicide & Crisis","988"],["US Coast Guard","VHF ch 16"]]) },
  { id:"rf-power", t:"Batteries & power", k:"watts, amp-hours", html:
    `<p class="xg-p"><b>Watts = volts × amps.</b> <b>Watt-hours = volts × amp-hours.</b> A 12 V 100 Ah battery holds ~1,200 Wh (lead-acid: use only ~50% → 600 Wh; LiFePO4: ~90%).</p>`
    + table(["Device","Typical draw"],[["Phone charging","5–20 W"],["Laptop","30–90 W"],["Steam Deck / handheld","15–30 W"],["LED bulb","8–10 W"],["Wi-Fi router","6–12 W"],["Fridge (avg)","100–200 W"],["CPAP","30–60 W"],["Space heater","1,500 W"],["Microwave","1,000–1,500 W"]])
    + `<p class="xg-p">Use <b>Tools → Battery runtime</b> to calculate how long a power bank or station will last.</p>` },
];

export const GUIDE_GROUPS = [
  { id:"aid",  label:"First aid",       items:FIRST_AID },
  { id:"surv", label:"Survival",        items:SURVIVAL },
  { id:"comm", label:"Radio & signals", items:COMMS },
  { id:"ref",  label:"Reference",       items:REFERENCE },
];

export const GOBAG = [
  ["Water","Water (1 gal/person/day, 3 days)","Filter or purification tablets","Collapsible bottle"],
  ["Food","3-day no-cook food","Can opener, spoon","Electrolyte packets"],
  ["Health","First-aid kit + tourniquet","7 days of prescriptions, copies of Rx","Glasses/contacts","N95 masks","Hand sanitizer, wipes"],
  ["Power & light","Headlamp + spare batteries","Power bank (charged) + cables","Hand-crank/solar NOAA weather radio"],
  ["Shelter & warmth","Emergency blankets","Rain poncho","Change of clothes, wool socks","Sturdy shoes"],
  ["Tools","Multi-tool or knife","Duct tape","Paracord (50 ft)","Lighter + ferro rod","Whistle","Work gloves"],
  ["Documents","ID, insurance, deeds (waterproof bag + encrypted USB)","Cash in small bills","Paper map of your area","Emergency contact list"],
  ["Comms","FRS/GMRS radios","Phone with T.U.R.D. Extras offline library"],
];

/* ===================================================================== MORSE */
export const MORSE = { A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",
  Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..",
  0:"-----",1:".----",2:"..---",3:"...--",4:"....-",5:".....",6:"-....",7:"--...",8:"---..",9:"----.",
  ".":".-.-.-",",":"--..--","?":"..--..","/":"-..-.","=":"-...-","+":".-.-.","-":"-....-","@":".--.-.","'":".----.","!":"-.-.--",":":"---..." };
const RMORSE = Object.fromEntries(Object.entries(MORSE).map(([k,v])=>[v,k]));
export function toMorse(s){
  return String(s).toUpperCase().split(/\s+/).filter(Boolean).map(w=>[...w].map(c=>MORSE[c]||"").filter(Boolean).join(" ")).join(" / ");
}
export function fromMorse(s){
  return String(s).trim().split(/\s*\/\s*|\s{3,}/).map(w=>w.split(/\s+/).map(c=>RMORSE[c.replace(/[·•]/g,".").replace(/[–—_]/g,"-")]||"?").join("")).join(" ");
}

/* ===================================================================== CALCULATORS */
export const UNITS = {
  Length:{ m:1, km:1000, cm:.01, mm:.001, mi:1609.344, yd:.9144, ft:.3048, in:.0254, "nmi":1852 },
  Mass:{ kg:1, g:.001, lb:.45359237, oz:.028349523125, "st":6.35029318, "t":1000 },
  Volume:{ L:1, mL:.001, gal:3.785411784, qt:.946352946, pt:.473176473, cup:.2365882365, "fl oz":.0295735295625, tbsp:.01478676478125, tsp:.00492892159375, "m³":1000 },
  Speed:{ "km/h":1, mph:1.609344, "m/s":3.6, kn:1.852 },
  Pressure:{ hPa:1, inHg:33.8638866667, mmHg:1.33322387415, psi:68.9475729318, kPa:10, bar:1000, atm:1013.25 },
  Energy:{ Wh:1, kWh:1000, J:1/3600, kJ:1/3.6, cal:0.001162222, kcal:1.162222, BTU:0.29307107 },
  Data:{ B:1, KB:1e3, MB:1e6, GB:1e9, TB:1e12, KiB:1024, MiB:1048576, GiB:1073741824 },
  Area:{ "m²":1, "km²":1e6, ha:1e4, acre:4046.8564224, "ft²":.09290304, "mi²":2589988.110336 },
};
export const TEMP = {
  conv(v, from, to){ const c = from==="°C"?v: from==="°F"?(v-32)*5/9 : v-273.15; return to==="°C"?c: to==="°F"?c*9/5+32 : c+273.15; },
  units:["°F","°C","K"],
};
// NWS wind chill (°F, mph). Valid for T ≤ 50 °F and V ≥ 3 mph.
export const windChill = (T,V)=> (T>50||V<3) ? null : 35.74 + 0.6215*T - 35.75*V**0.16 + 0.4275*T*V**0.16;
// NWS heat index (Rothfusz regression with the NWS adjustments), °F and %RH.
export function heatIndex(T,RH){
  let hi = 0.5*(T+61+((T-68)*1.2)+(RH*0.094));
  if((hi+T)/2 < 80) return hi;
  hi = -42.379 + 2.04901523*T + 10.14333127*RH - .22475541*T*RH - .00683783*T*T - .05481717*RH*RH + .00122874*T*T*RH + .00085282*T*RH*RH - .00000199*T*T*RH*RH;
  if(RH<13 && T>=80 && T<=112) hi -= ((13-RH)/4)*Math.sqrt((17-Math.abs(T-95))/17);
  else if(RH>85 && T>=80 && T<=87) hi += ((RH-85)/10)*((87-T)/5);
  return hi;
}
// Magnus dew point (°C in, °C out)
export function dewPoint(Tc,RH){ const a=17.62,b=243.12,g=Math.log(RH/100)+a*Tc/(b+Tc); return b*g/(a-g); }

// NOAA solar position → sunrise/sunset/solar noon (local Date objects). Accurate to ~1 minute.
export function sunTimes(date, lat, lon){
  const rad=Math.PI/180, d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate(),12));
  const jd = d/86400000 + 2440587.5, n = jd - 2451545.0;
  const Jstar = n - lon/360, M = (357.5291 + 0.98560028*Jstar) % 360;
  const C = 1.9148*Math.sin(M*rad) + 0.02*Math.sin(2*M*rad) + 0.0003*Math.sin(3*M*rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545.0 + Jstar + 0.0053*Math.sin(M*rad) - 0.0069*Math.sin(2*L*rad);
  const decl = Math.asin(Math.sin(L*rad)*Math.sin(23.4397*rad));
  const toDate = j => new Date((j - 2440587.5)*86400000);
  const hour = h0 => { const c=(Math.sin(h0*rad)-Math.sin(lat*rad)*Math.sin(decl))/(Math.cos(lat*rad)*Math.cos(decl)); return c<-1?"day":c>1?"night":Math.acos(c)/rad; };
  const out = { noon: toDate(Jtransit) };
  for(const [k,h0] of [["rise",-0.833],["civil",-6]]){
    const w = hour(h0);
    if(typeof w === "string"){ out[k]=w; out[k+"Set"]=w; continue; }
    out[k] = toDate(Jtransit - w/360); out[k+"Set"] = toDate(Jtransit + w/360);
  }
  out.dayLen = (out.rise instanceof Date) ? (out.riseSet - out.rise) : out.rise==="day" ? 864e5 : 0;
  return out;
}
// Moon phase 0..1 (0 new, .5 full) from a known new moon (2000-01-06 18:14 UTC).
export function moonPhase(date){ const syn=29.530588853, p=((date - Date.UTC(2000,0,6,18,14))/864e5/syn)%1; return p<0?p+1:p; }
export function moonName(p){ return ["New moon","Waxing crescent","First quarter","Waxing gibbous","Full moon","Waning gibbous","Last quarter","Waning crescent"][Math.round(p*8)%8]; }
