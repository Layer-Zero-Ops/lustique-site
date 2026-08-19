#!/usr/bin/env python3
"""
Batch-strip inline margin/padding/gap/border-radius styles from .astro files.
Replaces inline styles with CSS class-based spacing using the new var(--space-*) tokens.

Strategy:
- Remove inline margin/padding/gap values → rely on CSS class rules
- Keep inline styles that are NOT spacing: colors, fonts, display, position, etc.
- Remove the ENTIRE style attribute if it only contains spacing properties
- If style has non-spacing properties, keep the non-spacing ones and strip spacing
"""
import re
import glob
import os

SITE_SRC = "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/src"

# Spacing-related properties to strip from inline styles
SPACING_PROPS = [
    'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
    'margin-block', 'margin-inline', 'margin-block-start', 'margin-block-end',
    'margin-inline-start', 'margin-inline-end',
    'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
    'padding-block', 'padding-inline', 'padding-block-start', 'padding-block-end',
    'padding-inline-start', 'padding-inline-end',
    'gap', 'row-gap', 'column-gap',
    'border-radius',
]

def is_spacing(prop):
    """Check if a property name is a spacing property"""
    for sp in SPACING_PROPS:
        if prop.strip() == sp or prop.strip().startswith(sp + '-') or prop.strip().startswith(sp):
            return True
    return False

def parse_style(style_value):
    """Parse a style attribute value into (spacing_decls, non_spacing_decls)"""
    spacing = {}
    non_spacing = {}
    
    # Split by semicolons, handle escaped characters
    decls = [d.strip() for d in style_value.split(';') if d.strip()]
    
    for decl in decls:
        if ':' not in decl:
            continue
        prop, value = decl.split(':', 1)
        prop = prop.strip()
        value = value.strip()
        if is_spacing(prop):
            spacing[prop] = value
        else:
            non_spacing[prop] = value
    
    return spacing, non_spacing

def style_to_string(decls):
    """Convert a dict of declarations to a style string"""
    if not decls:
        return None
    return '; '.join(f'{k}: {v}' for k, v in decls.items())

def process_file(filepath):
    """Process a single .astro file, stripping spacing from inline styles"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    changes = []
    
    # Find all style="..." attributes (handling both single and double quotes)
    # Also handle Astro expression styles style:{...}
    
    def replace_style(match):
        full = match.group(0)
        style_val = match.group(1)
        spacing, non_spacing = parse_style(style_val)
        
        if spacing and non_spacing:
            # Keep non-spacing, drop spacing
            new_style = style_to_string(non_spacing)
            return 'style="' + new_style + '"'
        elif spacing and not non_spacing:
            # Only spacing → remove entire style attribute
            changes.append(f"  Removed spacing-only style: {full}")
            return ''
        # No spacing → keep as-is
        return full
    
    # Replace style="..." with spacing stripped
    content = re.sub(r'style="([^"]*)"', replace_style, content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return changes
    return []

# Find all .astro files
astro_files = glob.glob(f"{SITE_SRC}/**/*.astro", recursive=True)
total_changes = 0

for filepath in astro_files:
    changes = process_file(filepath)
    if changes:
        total_changes += len(changes)
        print(f"\n{filepath}:")
        for c in changes:
            print(c)

print(f"\nTotal inline style attributes modified: {total_changes}")

# Verify: count remaining margin-top inline styles
remaining = 0
for filepath in astro_files:
    with open(filepath, 'r') as f:
        content = f.read()
    count = content.count('style="')
    remaining += count

print(f"Remaining inline style attributes across all .astro files: {remaining}")
