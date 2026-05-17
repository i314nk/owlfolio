#!/usr/bin/env python3
"""Capture Owlfolio Web UI screenshots and stitch into a demo GIF.

Requires: selenium, google-chrome, ffmpeg
Usage: python3 scripts/capture_demo.py
"""

import glob
import os
import subprocess
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

URL = "http://localhost:8000"
OUT_DIR = "/tmp/owlfolio-captures"
FINAL_GIF = "docs/assets/owlfolio-demo.gif"

# Viewport: desktop-ish (wider than mobile, shorter for GIF clarity)
WIDTH = 1280
HEIGHT = 800


def setup_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument(f"--window-size={WIDTH},{HEIGHT}")
    # Force dark mode to match the UI theme
    opts.add_argument("--force-dark-mode")
    driver = webdriver.Chrome(options=opts)
    return driver


def wait_and_screenshot(driver, name, wait_sec=2):
    """Wait for page to settle, then screenshot."""
    time.sleep(wait_sec)
    path = os.path.join(OUT_DIR, f"{name}.png")
    driver.save_screenshot(path)
    print(f"  Captured: {name} ({os.path.getsize(path) // 1024}KB)")
    return path


def click_sidebar_tab(driver, tab_name):
    """Click a sidebar tab by its text label."""
    try:
        # Open sidebar first (hamburger menu)
        hamburger = driver.find_elements(By.CSS_SELECTOR, "button[\\@click*='sidebarOpen']")
        if hamburger:
            hamburger[0].click()
            time.sleep(0.5)

        # Find and click the tab
        tabs = driver.find_elements(By.XPATH, f"//*[contains(text(), '{tab_name}')]")
        for tab in tabs:
            if tab.is_displayed():
                tab.click()
                time.sleep(1)
                return True
    except Exception as e:
        print(f"  Warning: Could not click {tab_name}: {e}")
    return False


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Clean old captures
    for f in glob.glob(os.path.join(OUT_DIR, "*.png")):
        os.remove(f)

    print("Starting Chrome...")
    driver = setup_driver()

    def open_sidebar_and_switch_tab(tab_name):
        """Open sidebar and switch to a specific tab using Alpine.js state."""
        driver.execute_script(f"""
            // Set Alpine.js state directly on the root element
            const root = document.querySelector('[x-data]');
            if (root && root.__x) {{
                root.__x.$data.sidebarOpen = true;
                root.__x.$data.sidebarTab = '{tab_name}';
            }} else {{
                // Fallback: dispatch Alpine event or click by text
                document.querySelectorAll('button').forEach(b => {{
                    const txt = b.textContent.trim().toLowerCase();
                    if (txt === '{tab_name}') b.click();
                }});
                // Force sidebar open via attribute
                document.querySelectorAll('[x-data]').forEach(el => {{
                    if (el._x_dataStack) {{
                        el._x_dataStack[0].sidebarOpen = true;
                        el._x_dataStack[0].sidebarTab = '{tab_name}';
                    }}
                }});
            }}
        """)
        time.sleep(1.5)

    def fresh_page_with_tab(tab_name=None):
        """Load a fresh page (no stale WS state) and open a sidebar tab."""
        driver.get(URL)
        time.sleep(3)
        if tab_name:
            open_sidebar_and_switch_tab(tab_name)
            time.sleep(1.5)

    try:
        # 1. Dashboard / Chat view (landing page) with sidebar closed
        print("1. Dashboard...")
        fresh_page_with_tab()
        wait_and_screenshot(driver, "01_dashboard", wait_sec=1)

        # 2. Portfolio tab
        print("2. Portfolio tab...")
        fresh_page_with_tab("portfolio")
        wait_and_screenshot(driver, "02_portfolio", wait_sec=1)

        # 3. Watchlist tab
        print("3. Watchlist tab...")
        fresh_page_with_tab("watchlist")
        wait_and_screenshot(driver, "03_watchlist", wait_sec=1)

        # 4. Activity tab
        print("4. Activity tab...")
        fresh_page_with_tab("activity")
        wait_and_screenshot(driver, "04_activity", wait_sec=1)

        # 5. Schedule tab
        print("5. Schedule tab...")
        fresh_page_with_tab("schedule")
        wait_and_screenshot(driver, "05_schedule", wait_sec=1)

        # 6. Alerts tab
        print("6. Alerts tab...")
        fresh_page_with_tab("alerts")
        wait_and_screenshot(driver, "06_alerts", wait_sec=1)

    finally:
        driver.quit()

    # Stitch PNGs into GIF using ffmpeg
    print("\nStitching GIF...")
    frames = sorted(glob.glob(os.path.join(OUT_DIR, "*.png")))
    if not frames:
        print("No frames captured!")
        return

    # Use ffmpeg: 0.6 fps = ~1.7s per frame, good for browsing
    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        "0.5",  # 2 seconds per frame
        "-pattern_type",
        "glob",
        "-i",
        os.path.join(OUT_DIR, "*.png"),
        "-vf",
        "scale=800:-1:flags=lanczos,split[s0][s1];"
        "[s0]palettegen=max_colors=128[p];"
        "[s1][p]paletteuse=dither=bayer",
        "-loop",
        "0",
        FINAL_GIF,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ffmpeg error: {result.stderr[-500:]}")
        return

    size_kb = os.path.getsize(FINAL_GIF) // 1024
    print(f"\nDone! {FINAL_GIF} ({size_kb}KB, {len(frames)} frames)")


if __name__ == "__main__":
    main()
