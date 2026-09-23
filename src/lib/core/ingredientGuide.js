// Ingredient reference data, cataloged from the ingredient tracker
// spreadsheet. Two tables:
//
//  - INGREDIENT_DETAILS: the per-ingredient profile shown in the checker —
//    class, a plain-language description, the concerns it helps with, how
//    and when to use it, the main precaution, and simple compatibility
//    notes (as free text, since the sheet doesn't always format these as
//    clean lists — some rows write a full sentence instead of names).
//  - INGREDIENT_CONFLICTS: pairwise relationships between named actives,
//    each with a specific relationship (Compatible/Caution/Prefer
//    separate/Product-specific) and a suggested message. Used by
//    checkRoutineConflicts() to warn on real problem combinations in a
//    user's actual routine — never on "Compatible" pairs.
//
// Matching is name-based and deliberately loose (see findIngredientDetails/
// findIngredientConflicts below) since real product labels spell things
// inconsistently ("Vitamin C" vs "L-Ascorbic Acid (Vitamin C)").

export const INGREDIENT_DETAILS = [
  { ingredient: 'Retinol', class: 'Retinoids', about: 'A vitamin A derivative that increases skin cell turnover and supports collagen production.', mainUses: 'Acne, texture, fine lines, uneven tone', typicalFrequency: 'Start with 1–2 nights/week and increase based on tolerance', bestTime: 'PM', howToUse: 'Apply pea-sized amount to dry skin after cleansing; moisturize', precaution: 'Can cause dryness, irritation and peeling. Start with a low percentage. Use with caution with exfoliants/exfoliating acids', compatibleWith: 'Niacinamide, Hyaluronic Acid, Ceramides, Peptides, Squalane, Azelaic Acid', useCautionWith: 'Vitamin C, Benzoyl Peroxide, AHAs, BHAs' },
  { ingredient: 'Retinal (Retinaldehyde)', class: 'Retinoids', about: 'A vitamin A derivative that is one conversion step closer to retinoic acid than retinol, making it a potent retinoid option.', mainUses: 'Acne, texture, fine lines, uneven tone', typicalFrequency: 'Start with 1–2 nights/week and increase based on tolerance', bestTime: 'PM', howToUse: 'Pea-sized amount after cleansing; moisturize', precaution: 'Start slowly', compatibleWith: 'Ceramides, Hyaluronic Acid, Niacinamide, tranexamic acid, Kojic acid, alpha arbutin, beta-glucan, all moisturizing agents, all hydrating agents', useCautionWith: 'AHAs, BHAs, Benzoyl Peroxide' },
  { ingredient: 'Adapalene', class: 'Retinoids', about: 'A retinoid specifically developed for acne treatment with improved stability and tolerability.', mainUses: 'Acne, clogged pores, breakouts', typicalFrequency: 'Once daily', bestTime: 'PM', howToUse: 'Thin layer over acne-prone area, not just individual spots', precaution: 'Irritation is common initially. Use with caution with exfoliants/exfoliating acids', compatibleWith: 'Ceramides, Hyaluronic Acid, Niacinamide, tranexamic acid, Kojic acid, alpha arbutin, beta-glucan, all moisturizing agents, all hydrating agents', useCautionWith: 'AHAs, BHAs, Benzoyl Peroxide' },
  { ingredient: 'Tretinoin', class: 'Retinoids', about: 'A prescription-strength vitamin A derivative that speeds up skin cell turnover and is one of the most studied retinoids.', mainUses: 'Acne, photoaging, texture, pigmentation', typicalFrequency: 'Start with 1–2 nights/week and increase based on tolerance', bestTime: 'PM', howToUse: 'Pea-sized amount over entire treatment area', precaution: 'Start slowly. Use according to prescriber instructions . Use with caution with exfoliants/exfoliating acidstions. Best used with a thick moisturizer.', compatibleWith: 'Ceramides, Hyaluronic Acid, Niacinamide, tranexamic acid, Kojic acid, alpha arbutin, beta-glucan, all moisturizing agents, all hydrating agents', useCautionWith: 'AHAs, BHAs, Benzoyl Peroxide' },
  { ingredient: 'Salicylic Acid', class: 'Beta Hydroxy Acid (BHA)', about: 'An oil-soluble exfoliating acid that can penetrate pores and help remove buildup.', mainUses: 'Acne, blackheads, clogged pores, oily skin', typicalFrequency: '2–4×/week', bestTime: 'AM or PM', howToUse: 'Apply to clean, dry skin; leave-on products stay on', precaution: 'Can cause dryness/irritation', compatibleWith: 'Niacinamide, Hyaluronic Acid, Ceramides, Azelaic Acid, Kojic acid, alpha arbutin, all hydrating agents, all moisturizing agents', useCautionWith: 'Retinoids, Vitamin C, Benzoyl Peroxide' },
  { ingredient: 'Glycolic Acid', class: 'Alpha Hydroxy Acid (AHA)', about: 'A water-soluble exfoliating acid that removes dead skin cells from the surface of the skin.', mainUses: 'Texture, dullness, uneven tone, hyperpigmentation', typicalFrequency: '1–3×/week', bestTime: 'PM', howToUse: 'Apply to clean, dry skin; follow product instructions', precaution: 'Avoid over-exfoliation', compatibleWith: 'Niacinamide, Hyaluronic Acid, Ceramides, Azelaic Acid, Kojic acid, Mandelic acid, lactic acid, alpha arbutin, all hydrating agents, all moisturizing agents', useCautionWith: 'Retinoids, Vitamin C, Benzoyl Peroxide' },
  { ingredient: 'Lactic Acid', class: 'Alpha Hydroxy Acid (AHA)', about: 'A gentler exfoliating acid that also has hydrating properties.', mainUses: 'Dryness, texture, dull skin, uneven tone', typicalFrequency: '1–3×/week', bestTime: 'PM', howToUse: 'Apply after cleansing according to product directions', precaution: 'May irritate sensitive skin', compatibleWith: 'Niacinamide, Hyaluronic Acid, Ceramides, Azelaic Acid, Kojic acid, alpha arbutin, all hydrating agents, all moisturizing agents', useCautionWith: 'Retinoids, Vitamin C, Benzoyl Peroxide' },
  { ingredient: 'Mandelic Acid', class: 'Alpha Hydroxy Acid', about: 'A larger molecule AHA that exfoliates more gradually and may be better tolerated by some sensitive skin types.', mainUses: 'Acne, texture, pigmentation, dullness', typicalFrequency: '1–3×/week', bestTime: 'PM', howToUse: 'Apply after cleansing according to product directions', precaution: 'Start slowly', compatibleWith: 'Niacinamide, Hyaluronic Acid, Ceramides, Azelaic Acid, Kojic acid, alpha arbutin, Salicylic acid, all hydrating agents, all moisturizing agents', useCautionWith: 'Retinoids, Vitamin C, Benzoyl Peroxide' },
  { ingredient: 'Gluconolactone', class: 'Poly Hydroxy Acid (PHA)', about: 'A gentle exfoliating acid with larger molecules than AHAs, making it less irritating while providing hydration benefits.', mainUses: 'Sensitive skin, texture, dullness, uneven tone', typicalFrequency: '2–4×/week', bestTime: 'AM or PM', howToUse: 'Apply after cleansing', precaution: 'Generally gentler, but irritation is still possible', compatibleWith: 'Niacinamide, Hyaluronic Acid, Ceramides, Azelaic Acid, Kojic acid, alpha arbutin, Salicylic acid, all hydrating agents, all moisturizing agents', useCautionWith: 'Retinoids, strong acids' },
  { ingredient: 'Benzoyl Peroxide', class: 'Acne treatment', about: 'An antibacterial ingredient that helps reduce acne-causing bacteria and inflammation.', mainUses: 'Acne, inflammatory pimples', typicalFrequency: 'Once daily or every other day', bestTime: 'AM or PM', howToUse: 'Apply to acne-prone areas or use as wash depending on product', precaution: 'Can dry out the skin. Start with a lower percentage.', compatibleWith: 'Niacinamide, Ceramides, Hydrating ingredients', useCautionWith: 'Retinoids, Vitamin C' },
  { ingredient: 'Azelaic Acid', class: 'Dicarboxylic acid', about: 'A naturally occurring acid with anti-inflammatory, antibacterial, and pigment-regulating properties.', mainUses: 'Acne, redness, post-inflammatory hyperpigmentation, uneven tone', typicalFrequency: 'Once or twice daily', bestTime: 'AM or PM', howToUse: 'Apply thin layer after cleansing', precaution: 'May cause temporary stinging', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Niacinamide', class: 'Antioxidant', about: 'A versatile ingredient that supports the skin barrier and helps regulate oil production and inflammation.', mainUses: 'Oiliness, redness, enlarged pores appearance, uneven tone', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply serum after cleansing', precaution: 'Usually well tolerated', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'L-Ascorbic Acid (Vitamin C)', class: 'Antioxidant', about: 'A powerful antioxidant that helps protect skin from environmental stress and supports collagen production.', mainUses: 'Dark spots, dullness, uneven tone, antioxidant protection', typicalFrequency: 'Once daily', bestTime: 'AM', howToUse: 'Apply after cleansing, before moisturizer/SPF', precaution: 'Can irritate sensitive skin', compatibleWith: 'Retinoids, AHA, BHA', useCautionWith: '' },
  { ingredient: 'Tranexamic Acid', class: 'Pigment modulator', about: 'An ingredient that helps reduce pathways involved in excess pigmentation.', mainUses: 'Melasma, post-inflammatory hyperpigmentation, dark spots', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply serum after cleansing', precaution: 'Monitor for irritation when combined with multiple actives', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Kojic Acid', class: 'Tyrosinase inhibitor', about: 'A compound derived from fungi that helps reduce pigment formation in the skin.', mainUses: 'Dark spots, uneven tone, hyperpigmentation', typicalFrequency: 'Once daily or every other day', bestTime: 'AM or PM', howToUse: 'Apply according to product directions', precaution: 'Can irritate with excessive use', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Alpha Arbutin', class: 'Tyrosinase inhibitor', about: 'A brightening ingredient that helps reduce excess melanin production.', mainUses: 'Hyperpigmentation, dark spots, uneven skin tone', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply serum after cleansing', precaution: 'Generally well tolerated', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Hydroquinone', class: 'Tyrosinase inhibitor', about: 'A potent pigment-reducing ingredient that works by decreasing melanin production.', mainUses: 'Hyperpigmentation, melasma, dark spots', typicalFrequency: 'Product/prescriber-specific', bestTime: 'Usually PM', howToUse: 'Apply only to affected pigmentation as directed', precaution: 'Should not be treated as an indefinite daily skincare ingredient', compatibleWith: 'Retinoids, AHAs, BHAs,', useCautionWith: '' },
  { ingredient: 'Peptides', class: 'Skin-Signalling Ingredients', about: 'Short chains of amino acids that act as messengers to support skin functions.', mainUses: 'Fine lines, firmness, skin repair', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply serum after cleansing', precaution: 'Use according to prescription', compatibleWith: 'Hyaluronic Acid, Ceramides, Niacinamide, Retinoids', useCautionWith: 'Strong acids' },
  { ingredient: 'Hyaluronic Acid', class: 'Humectant', about: 'A water-binding ingredient that helps attract and retain moisture in the skin.', mainUses: 'Dehydration, dryness, plumping effect', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply to slightly damp skin, then moisturize', precaution: 'Follow with moisturizer', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Glycerin', class: 'Humectant', about: 'A skin-identical humectant that attracts water to the skin and helps maintain hydration.', mainUses: 'Dryness, dehydration, skin barrier support', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Usually included in moisturizer/serum; apply normally', precaution: 'Generally well tolerated', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Panthenol', class: 'Humectant/Soothing agent', about: 'A vitamin B5 derivative that helps hydrate and soothe the skin.', mainUses: 'Dryness, irritation, barrier support', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply through serum/moisturizer', precaution: 'Generally well tolerated', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Ceramides', class: 'Skin barrier lipids', about: 'Lipids naturally found in the skin that help maintain and repair the skin barrier.', mainUses: 'Dryness, damaged barrier, sensitivity', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply as moisturizer/cream', precaution: 'Excellent for barrier support', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Squalane', class: 'Emollient', about: 'A lightweight oil-like ingredient that softens and moisturises the skin without feeling heavy.', mainUses: 'Dryness, barrier support, moisture retention', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply a few drops after water-based products/moisturizer', precaution: 'Adjust amount according to skin type', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Centella Asiatica', class: 'Botanical soothing agent', about: 'A plant extract known for its soothing and antioxidant properties.', mainUses: 'Redness, irritation, barrier support', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply serum/essence after cleansing', precaution: 'Generally well tolerated', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Allantoin', class: 'Soothing Agent', about: 'A skin-conditioning ingredient known for calming and supporting skin comfort.', mainUses: 'Irritation, dryness, sensitive skin', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Usually applied through creams/serums', precaution: 'Generally well tolerated', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Beta-Glucan', class: 'Humectant/Soothing Agent', about: 'A polysaccharide that attracts water and helps calm the skin.', mainUses: 'Dryness, sensitivity, barrier support', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Usually used within a serum or moisturizer', precaution: 'Follow product formulation', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Propolis', class: 'Bee-Derived Extract / Soothing Ingredient', about: 'A resinous substance produced by bees that contains antioxidant and soothing compounds.', mainUses: 'Redness, irritation, hydration, supporting acne-prone skin', typicalFrequency: '1–2× daily', bestTime: 'AM or PM', howToUse: 'Apply essence/serum after cleansing', precaution: 'Avoid if allergic/sensitive to bee products', compatibleWith: 'All propolis', useCautionWith: '' },
  { ingredient: 'Zinc oxide', class: 'Mineral UV Filter', about: 'A mineral sunscreen ingredient that protects skin by reflecting and scattering UV radiation.', mainUses: 'Sun protection, sensitive skin sunscreen', typicalFrequency: 'Apply and reapply during the day', bestTime: 'AM', howToUse: 'Last step in your morning routine', precaution: '', compatibleWith: '', useCautionWith: '' },
  { ingredient: 'Titanium dioxide', class: 'Mineral UV Filter', about: 'A mineral sunscreen ingredient that provides protection mainly against UVB and some UVA rays.', mainUses: 'Sun protection', typicalFrequency: 'Apply and reapply during the day', bestTime: 'AM', howToUse: 'Last step in your morning routine', precaution: '', compatibleWith: '', useCautionWith: '' },
  { ingredient: 'Sulfur', class: 'Keratolytic/Antimicrobial agent', about: 'A mineral ingredient that helps reduce oiliness and support acne-prone skin.', mainUses: 'Acne, excess oil, clogged pores', typicalFrequency: 'Once a week', bestTime: 'AM or PM', howToUse: 'Apply and leave on for few minutes before rinsing off', precaution: '', compatibleWith: 'Generally compatible with niacinamide, hyaluronic acid, ceramides, glycerin, panthenol, azelaic acid. Use caution when combining with retinoids, AHAs, BHAs, benzoyl peroxide, or other acne treatments because it may increase dryness or irritation.', useCautionWith: '' },
  { ingredient: 'Squalene', class: 'Lipid', about: 'A natural skin lipid that provides moisturising benefits (different from stable squalane).', mainUses: 'Hydration, softness', typicalFrequency: 'Daily', bestTime: 'AM or PM', howToUse: '', precaution: '', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Melasyl™', class: 'Pigment-Regulating Ingredient', about: 'A patented ingredient designed to help reduce excess melanin formation by targeting pigment pathways before visible dark spots develop.', mainUses: 'Dark spots, post-inflammatory hyperpigmentation, uneven tone', typicalFrequency: '1-2x daily', bestTime: 'AM/PM', howToUse: 'Apply after your toner, before moisturizer', precaution: '', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Bakuchiol', class: 'Retinol Alternative / Botanical Active', about: 'A plant-derived ingredient with retinol-like benefits but a different chemical structure.', mainUses: 'Texture, fine lines, uneven tone', typicalFrequency: 'Daily', bestTime: 'PM', howToUse: 'Apply on dry skin', precaution: '', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Thiamidol', class: 'Tyrosinase Inhibitor / Brightening Active', about: 'A patented ingredient that targets melanin production by inhibiting tyrosinase, an enzyme involved in pigment formation.', mainUses: 'Hyperpigmentation, dark spots, uneven skin tone', typicalFrequency: '1-2x daily', bestTime: 'AM/PM', howToUse: 'Use after your cleanser/toner, before moisturizer', precaution: '', compatibleWith: '', useCautionWith: '' },
  { ingredient: 'Lactobionic acid', class: 'Poly Hydroxy Acid (PHA)', about: 'A gentle exfoliating and antioxidant ingredient derived from lactose.', mainUses: 'Texture, hydration, sensitive skin, signs of aging', typicalFrequency: 'Daily', bestTime: 'PM', howToUse: '', precaution: '', compatibleWith: '', useCautionWith: '' },
  { ingredient: 'Licorice Root Extract', class: 'Botanical Brightening Ingredient', about: 'A plant extract containing compounds that can help reduce uneven pigmentation and soothe skin.', mainUses: 'Dark spots, redness, uneven tone', typicalFrequency: '1-2x daily', bestTime: 'AM/PM', howToUse: '', precaution: '', compatibleWith: 'All Ingredients', useCautionWith: '' },
  { ingredient: 'Snail mucin', class: 'Skin repair/ Humectant', about: 'A snail-derived ingredient rich in humectants, glycoproteins, and other compounds that support hydration.', mainUses: 'Hydration, barrier support, uneven texture', typicalFrequency: '1-2x daily', bestTime: 'AM/PM', howToUse: 'Apply after your cleanser/toner, before serum/moisturizer', precaution: '', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'N-Acetyl Glucosamine (NAG)', class: 'Amino Sugar / Brightening Active', about: 'A naturally occurring compound involved in skin processes and often used with niacinamide for brightening.', mainUses: 'Uneven tone, hyperpigmentation, barrier support', typicalFrequency: '1-2x daily', bestTime: 'AM/PM', howToUse: 'Apply after your cleanser/toner, before serum/moisturizer', precaution: '', compatibleWith: 'All ingredients', useCautionWith: '' },
  { ingredient: 'Retinyl Palmitate', class: 'Retinoid ester', about: 'A gentler vitamin A derivative that requires multiple conversions before becoming active retinoic acid.', mainUses: 'Mild anti-aging support, skin conditioning', typicalFrequency: 'Daily', bestTime: 'PM', howToUse: 'Apply on dry skin', precaution: '', compatibleWith: '', useCautionWith: '' },
  { ingredient: 'Vitamin E (Tocopherol)', class: 'Antioxidant', about: 'A fat-soluble antioxidant that also helps condition the skin.', mainUses: 'Barrier support, dryness, antioxidant protection', typicalFrequency: '1-2x daily', bestTime: 'AM/PM', howToUse: 'Comes in most serums.', precaution: '', compatibleWith: 'All ingredients', useCautionWith: '' },
]

export const INGREDIENT_CONFLICTS = [
  { a: 'Retinol', b: 'Salicylic Acid', relationship: 'Prefer separate', action: 'Separate routines', message: 'Both can increase irritation. Consider using them on different nights.' },
  { a: 'Retinol', b: 'Glycolic Acid', relationship: 'Prefer separate', action: 'Separate routines', message: 'Consider alternating your retinoid and glycolic acid to reduce irritation.' },
  { a: 'Retinol', b: 'Lactic Acid', relationship: 'Prefer separate', action: 'Separate routines', message: 'Consider using these on different nights, especially while introducing them.' },
  { a: 'Retinol', b: 'Mandelic Acid', relationship: 'Prefer separate', action: 'Separate routines', message: 'Using both may increase irritation. Consider alternating nights.' },
  { a: 'Retinol', b: 'PHA', relationship: 'Prefer separate', action: 'Separate routines', message: 'These can increase exfoliation/irritation load. Consider separating if sensitive.' },
  { a: 'Retinol', b: 'Benzoyl Peroxide', relationship: 'Product-specific', action: 'Separate routines', message: 'These can sometimes be used together, but the specific retinoid and product directions matter.' },
  { a: 'Retinol', b: 'Azelaic Acid', relationship: 'Compatible', action: 'Allow', message: 'Generally possible together, but monitor for irritation.' },
  { a: 'Retinol', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'These ingredients can generally be used together.' },
  { a: 'Retinol', b: 'Hyaluronic Acid', relationship: 'Compatible', action: 'Allow', message: 'Hydrating ingredients can generally be used with retinoids.' },
  { a: 'Retinol', b: 'Ceramides', relationship: 'Compatible', action: 'Allow', message: 'Barrier-supporting ingredients can generally be used with retinoids.' },
  { a: 'Retinol', b: 'Panthenol', relationship: 'Compatible', action: 'Allow', message: 'Panthenol can generally be used alongside retinoids.' },
  { a: 'Retinol', b: 'Vitamin C', relationship: 'Caution', action: 'Separate routines', message: 'Use Vitamin C in the morning, Retinol at night.' },
  { a: 'Retinal', b: 'Salicylic Acid', relationship: 'Prefer separate', action: 'Separate routines', message: 'Consider alternating these actives to reduce irritation.' },
  { a: 'Retinal', b: 'Glycolic Acid', relationship: 'Prefer separate', action: 'Separate routines', message: 'Consider using these on different nights.' },
  { a: 'Adapalene', b: 'Benzoyl Peroxide', relationship: 'Compatible', action: 'Allow', message: 'This is an established acne-treatment combination when used as directed.' },
  { a: 'Adapalene', b: 'Salicylic Acid', relationship: 'Caution', action: 'Separate routines', message: 'Both may increase dryness or irritation. Consider separating if your skin is sensitive.' },
  { a: 'Adapalene', b: 'Glycolic Acid', relationship: 'Prefer separate', action: 'Separate routines.', message: 'Consider using glycolic acid on a different night.' },
  { a: 'Tretinoin', b: 'Benzoyl Peroxide', relationship: 'Product-specific', action: 'Separate routines', message: 'Follow the specific product/clinician directions because formulation and timing matter.' },
  { a: 'Tretinoin', b: 'Salicylic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'Consider separating these to reduce irritation.' },
  { a: 'Tretinoin', b: 'Glycolic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'Both can increase irritation. Consider alternating nights.' },
  { a: 'Salicylic Acid', b: 'Glycolic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'You have two exfoliating acids. Consider using them on different nights.' },
  { a: 'Salicylic Acid', b: 'Lactic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'Combining exfoliating acids may increase irritation.' },
  { a: 'Salicylic Acid', b: 'Mandelic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'Consider choosing one exfoliating acid per routine.' },
  { a: 'Salicylic Acid', b: 'PHA', relationship: 'Caution', action: 'Monitor', message: 'Multiple exfoliating ingredients can increase irritation.' },
  { a: 'Salicylic Acid', b: 'Benzoyl Peroxide', relationship: 'Caution', action: 'Monitor/separate', message: 'Both target acne but may increase dryness when combined.' },
  { a: 'Salicylic Acid', b: 'Azelaic Acid', relationship: 'Caution', action: 'Allow, monitor', message: 'These can be used together if tolerated, but irritation is possible.' },
  { a: 'Salicylic Acid', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Salicylic Acid', b: 'Hyaluronic Acid', relationship: 'Compatible', action: 'Allow', message: 'Hydrating ingredients can support tolerability.' },
  { a: 'Salicylic Acid', b: 'Ceramides', relationship: 'Compatible', action: 'Allow', message: 'Barrier-supporting ingredients can be used alongside salicylic acid.' },
  { a: 'Glycolic Acid', b: 'Lactic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'Both are AHAs; using both may increase exfoliation and irritation.' },
  { a: 'Glycolic Acid', b: 'Mandelic Acid', relationship: 'Prefer separate', action: 'Separate', message: 'Consider using one AHA at a time.' },
  { a: 'Glycolic Acid', b: 'PHA', relationship: 'Caution', action: 'Monitor', message: 'Multiple exfoliating acids may increase irritation.' },
  { a: 'Glycolic Acid', b: 'Benzoyl Peroxide', relationship: 'Caution', action: 'Separate', message: 'Consider separating these to reduce irritation.' },
  { a: 'Glycolic Acid', b: 'Azelaic Acid', relationship: 'Caution', action: 'Monitor', message: 'Can be used in some routines, but monitor for irritation.' },
  { a: 'Glycolic Acid', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Glycolic Acid', b: 'Hyaluronic Acid', relationship: 'Compatible', action: 'Allow', message: 'Hydrating ingredients can generally be used together.' },
  { a: 'Azelaic Acid', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible and commonly combined.' },
  { a: 'Azelaic Acid', b: 'Tranexamic Acid', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible for pigmentation-focused routines.' },
  { a: 'Azelaic Acid', b: 'Alpha Arbutin', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Azelaic Acid', b: 'Vitamin C', relationship: 'Caution', action: 'Allow, monitor', message: 'Can be combined if tolerated; separate if irritation occurs.' },
  { a: 'Azelaic Acid', b: 'Benzoyl Peroxide', relationship: 'Caution', action: 'Monitor', message: 'Both target acne; monitor for dryness/irritation.' },
  { a: 'Niacinamide', b: 'Vitamin C', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Niacinamide', b: 'Tranexamic Acid', relationship: 'Compatible', action: 'Allow', message: 'Commonly combined in pigmentation products.' },
  { a: 'Niacinamide', b: 'Alpha Arbutin', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Niacinamide', b: 'Kojic Acid', relationship: 'Compatible', action: 'Allow, monitor', message: 'Generally compatible, but kojic acid can irritate some skin.' },
  { a: 'Niacinamide', b: 'Peptides', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Niacinamide', b: 'Ceramides', relationship: 'Compatible', action: 'Allow', message: 'Good combination for barrier support.' },
  { a: 'Niacinamide', b: 'Panthenol', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Vitamin C', b: 'Vitamin E', relationship: 'Compatible', action: 'Allow', message: 'Commonly combined antioxidant ingredients.' },
  { a: 'Vitamin C', b: 'Ferulic Acid', relationship: 'Compatible', action: 'Allow', message: 'Commonly formulated together in antioxidant products.' },
  { a: 'Vitamin C', b: 'Hyaluronic Acid', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Vitamin C', b: 'Peptides', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible; formulation matters.' },
  { a: 'Vitamin C', b: 'Benzoyl Peroxide', relationship: 'Caution', action: 'Separate', message: 'Consider separating to reduce irritation and because formulations can matter.' },
  { a: 'Tranexamic Acid', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Tranexamic Acid', b: 'Azelaic Acid', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Tranexamic Acid', b: 'Retinol', relationship: 'Caution', action: 'Allow, monitor', message: 'Compatible.' },
  { a: 'Kojic Acid', b: 'Retinol', relationship: 'Compatible', action: 'Allow', message: 'Compatible.' },
  { a: 'Kojic Acid', b: 'Glycolic Acid', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Kojic Acid', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Alpha Arbutin', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Alpha Arbutin', b: 'Vitamin C', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Hydroquinone', b: 'Retinoid', relationship: 'Product-specific', action: 'Separate routines', message: 'Use according to your treatment plan; multiple treatment actives may increase irritation.' },
  { a: 'Hydroquinone', b: 'AHA', relationship: 'Product-specific', action: 'Separate routines', message: 'Follow the specific treatment plan rather than automatically combining these.' },
  { a: 'Hydroquinone', b: 'Niacinamide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Ceramides', b: 'Retinoids', relationship: 'Compatible', action: 'Allow', message: 'Barrier-supporting ingredients can be helpful alongside retinoids.' },
  { a: 'Ceramides', b: 'AHAs', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Ceramides', b: 'Benzoyl Peroxide', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible and useful for supporting the skin barrier.' },
  { a: 'Hyaluronic Acid', b: 'Retinoids', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Hyaluronic Acid', b: 'AHAs', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Panthenol', b: 'Retinoids', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
  { a: 'Panthenol', b: 'AHAs', relationship: 'Compatible', action: 'Allow', message: 'Generally compatible.' },
]

// Strips a trailing "(...)" qualifier and lowercases, so "Salicylic Acid
// (BHA)" and "Salicylic Acid" compare equal, while the parenthetical stays
// searchable too (handled separately below).
const normalize = (s) => s.toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').trim()

const aliasesFor = (name) => {
  const aliases = [normalize(name)]
  const paren = /\(([^)]+)\)/.exec(name)
  if (paren) aliases.push(normalize(paren[1]))
  return aliases
}

export function findIngredientDetails(query) {
  const term = normalize(query)
  if (!term) return null

  return (
    INGREDIENT_DETAILS.find((entry) => aliasesFor(entry.ingredient).some((a) => a === term)) ||
    INGREDIENT_DETAILS.find((entry) => aliasesFor(entry.ingredient).some((a) => a.includes(term) || term.includes(a))) ||
    null
  )
}

export function findIngredientConflicts(query) {
  const term = normalize(query)
  if (!term) return []

  const matches = (name) => {
    const aliases = aliasesFor(name)
    return aliases.some((a) => a === term || a.includes(term) || term.includes(a))
  }

  return INGREDIENT_CONFLICTS.filter((c) => matches(c.a) || matches(c.b)).map((c) => ({
    ...c,
    with: matches(c.a) ? c.b : c.a,
  }))
}

// A short acronym like "AHA" needs word boundaries or it'll match inside
// an unrelated word; a multi-word name like "Salicylic Acid" is safe as a
// plain substring check.
const textContains = (text, alias) =>
  alias.length <= 4 ? new RegExp(`\\b${alias}\\b`, 'i').test(text) : text.includes(alias)

// Scans a blob of product text (name + ingredients) and returns which
// ingredients from our database it actually contains, as their canonical
// display names. Used to work out what a step in a routine is really made
// of, the same way detectActive() works out its broad ACTIVES bucket.
export function detectKnownIngredients(text) {
  const lower = String(text || '').toLowerCase()
  if (!lower.trim()) return []

  const found = []
  for (const name of allKnownIngredients()) {
    if (aliasesFor(name).some((alias) => textContains(lower, alias))) {
      found.push(name)
    }
  }
  return found
}

// Checks every pair of DIFFERENT steps in a routine (not ingredients
// within the same product — that's the manufacturer's formulation, not
// something the user chose to combine) for a known, named-ingredient
// conflict. Only relationships other than "Compatible" are returned, so a
// routine full of ingredients that happen to play well together produces
// no warnings at all.
export function checkRoutineConflicts(steps) {
  const withIngredients = steps.map((step) => ({
    step,
    ingredients: detectKnownIngredients([step.ingredients, step.name].filter(Boolean).join(' ')),
  }))

  const warnings = []
  const seen = new Set()

  for (let i = 0; i < withIngredients.length; i++) {
    for (let j = i + 1; j < withIngredients.length; j++) {
      const stepA = withIngredients[i]
      const stepB = withIngredients[j]

      for (const ingredientA of stepA.ingredients) {
        for (const ingredientB of stepB.ingredients) {
          if (normalize(ingredientA) === normalize(ingredientB)) continue

          const rule = INGREDIENT_CONFLICTS.find(
            (c) =>
              (normalize(c.a) === normalize(ingredientA) && normalize(c.b) === normalize(ingredientB)) ||
              (normalize(c.a) === normalize(ingredientB) && normalize(c.b) === normalize(ingredientA))
          )

          if (!rule || rule.relationship === 'Compatible') continue

          const key = [stepA.step.id, stepB.step.id, normalize(ingredientA), normalize(ingredientB)].sort().join('|')
          if (seen.has(key)) continue
          seen.add(key)

          warnings.push({
            stepAName: stepA.step.name,
            stepBName: stepB.step.name,
            ingredientA,
            ingredientB,
            relationship: rule.relationship,
            message: rule.message,
          })
        }
      }
    }
  }

  return warnings
}

// Used by the ingredient checker's browse list — every ingredient we have
// any data on, deduped, alphabetical. The sheet spells the same ingredient
// a few different ways across its tabs ("Glycolic Acid" vs "Glycolic Acid
// (AHA)"), so this dedupes by normalized name and keeps whichever spelling
// is longer (the more descriptive one, usually the one with the acronym).
export function allKnownIngredients() {
  const byNormalized = new Map()

  const consider = (name) => {
    if (!name) return
    const key = normalize(name)
    const existing = byNormalized.get(key)
    if (!existing || name.length > existing.length) {
      byNormalized.set(key, name)
    }
  }

  for (const entry of INGREDIENT_DETAILS) consider(entry.ingredient)
  for (const c of INGREDIENT_CONFLICTS) {
    consider(c.a)
    consider(c.b)
  }

  return [...byNormalized.values()].sort((a, b) => a.localeCompare(b))
}
