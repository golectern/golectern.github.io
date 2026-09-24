# Lectern

Lectern is your own classroom presentation hub, built on your friend's Remco and extended. It runs entirely in the browser: there's no account, no server and no monthly limit.

## What it does

**Lessons**
- Upload PDF, PPTX and image slides (PNG/JPG/GIF/WEBP/SVG). You can also add video files (MP4/WEBM), YouTube, Vimeo and Google Drive videos, Google Slides links, web pages, and blank white, grid or black boards.
- Library of saved lessons: reorder slides by dragging, duplicate, rename, and add per-slide notes. Speaker notes from PPTX files are imported automatically.
- Download any lesson as a PDF, with your drawings included.
- Back up everything to one `.lectern` file and restore it on another computer.

**Presenting** (keyboard shortcuts and presentation clickers work)
- Laser pointer (you can type text next to it), pen, highlighter, eraser, text labels, numbered markers, shapes (rectangle, circle, arrow, line; outline or filled), spotlight, zoom, black/white screen, and undo/clear.
- Drawings are saved with the lesson.
- Countdown timer and stopwatch, slide overview grid, and a notes panel.
- The screen stays awake while you present.

**Phone remote** (scan the QR code, protected by a PIN)
- Next/Prev buttons, swipe, or tap the slide preview.
- A drawing pad that mirrors the slide, with every tool available.
- Presenter view: the next slide, your notes (editable), and a list of all slides to jump to.
- Controls for video play/pause/mute, the timer, and the black/white screen.
- **Camera:** take a photo of a student's work and it appears on the big screen as a new slide.
- **Live controls:** start a quiz, reveal answers, show Q&A, pick a random student, and see raised hands.

**Audience** (students scan a QR code; no app needed; English and Kurdish)
- Live quizzes with 7 question types: multiple choice, True/False, poll, typed answer (auto-marked or marked by you with 0–5 stars), word cloud, idea wall (comments and reactions), and rating scale.
- Speed-bonus scoring, time limits, images on questions and options, and a "source / further reading" line shown after each answer.
- Leaderboard with a podium, confetti, and "spotlight an answer".
- Anonymous Q&A with upvotes. Emoji reactions float across the screen.
- ✋ Raise hand, 😵 "I'm lost" and 🐢 "Slow down" signals.
- A student question bank, where students submit questions you can add to a quiz.
- 🎲 Random student picker that gives everyone a turn before anyone is picked twice.
- Results export to Excel and PDF, plus an attendance list in Excel.
- Quizzes can be bulk-imported from Excel (use the **Excel template** button).

## How to use it

1. **On your laptop:** open `index.html`, or better, open your published address (see below).
2. Upload your files, then press **Start lesson**.
3. Press **📱** on the toolbar. Scan the left QR code with your phone and enter the PIN; your phone is now the remote. Students scan the right QR code.
4. Keep the lesson tab open while you teach. Phones connect straight to the laptop over the internet.

## Putting it online (needed for phones)

Phones need a public web address to open the remote and audience pages. The free option is GitHub Pages:

1. Create a free account at github.com with the username **golectern**. You have to do this yourself.
2. Create a new **public** repository named exactly **golectern.github.io**.
3. Choose **Add file → Upload files** and drag in *everything inside this folder* (index.html, css, js, vendor, and the rest).
4. Go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` / root, and save.
5. After about a minute Lectern is live at **https://golectern.github.io**. Open that address on your laptop from now on.

If you'd rather keep opening the hub from your disk, put the address in `js/config.js` (`publicUrl`) or in **⚙ Settings → Public web address**. The QR codes will then point to it.

> Your lessons are saved in the browser you use. The disk copy (`index.html`) and the online address keep **separate** libraries. Pick one, or move lessons between them with Backup → Restore.

## Notes and limits

- If a school network blocks the phone connection, run the laptop from a phone hotspot.
- Google Slides only embed if the deck is shared as "Anyone with the link". For the best quality, download the deck as a PDF and upload that.
- For old `.ppt` files, save them as `.pptx` or PDF first. Complex PowerPoint animations are shown as the final slide.
- YouTube videos need the hub to be opened from its web address (not from the disk) to play.
