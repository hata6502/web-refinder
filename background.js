import filesize from "./filesize.esm.min.js";

chrome.bookmarks.onCreated.addListener(async (_id, bookmark) => {
  await createGyazo({
    title: bookmark.title,
    url: bookmark.url,
  });
});

const downloadItems = new Map();

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (
    // Reject Data URLs
    downloadItem.url.length >= 1024 ||
    downloadItem.url.startsWith("blob:https://gyazo.com")
  ) {
    return;
  }

  downloadItems.set(downloadItem.id, downloadItem);
});

chrome.downloads.onDeterminingFilename.addListener((partialDownloadItem) => {
  const prevDownloadItem = downloadItems.get(partialDownloadItem.id);

  if (!prevDownloadItem) {
    return;
  }

  const downloadItem = {
    ...prevDownloadItem,
    ...partialDownloadItem,
  };

  downloadItems.set(downloadItem.id, downloadItem);
});

chrome.downloads.onChanged.addListener(async ({ id, ...downloadItemDelta }) => {
  const prevDownloadItem = downloadItems.get(id);

  if (!prevDownloadItem) {
    return;
  }

  const downloadItem = {
    ...prevDownloadItem,
    ...Object.fromEntries(
      Object.entries(downloadItemDelta).map(([key, value]) => [
        key,
        value.current,
      ])
    ),
  };

  downloadItems.set(downloadItem.id, downloadItem);

  if (downloadItem.state !== "complete") {
    return;
  }

  downloadItems.delete(downloadItem.id);

  await createGyazo({
    description: filesize(downloadItem.fileSize),
    url: downloadItem.url,
  });
});

const createGyazo = async ({ description, title, url }) => {
  const thumbnailURL = await getThumbnailURL({ url });
  const canvasElement = document.createElement("canvas");
  const canvasContext = canvasElement.getContext("2d");
  const imageElement = new Image();

  imageElement.onload = async () => {
    const zoom = Math.max(
      128 / imageElement.naturalWidth,
      128 / imageElement.naturalHeight,
      1
    );

    canvasElement.width = imageElement.naturalWidth * zoom;
    canvasElement.height = imageElement.naturalHeight * zoom + 48;

    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const shortHash = hash.slice(0, 8);
    const resolvedTitle = title ?? new URL(url).pathname.split("/").pop();

    canvasContext.fillStyle = "#ffffff";
    canvasContext.fillRect(0, 0, canvasElement.width, canvasElement.height);
    canvasContext.fillStyle = "#000000";
    canvasContext.font = "14px serif";
    canvasContext.fillText(shortHash, 0, 16);
    canvasContext.fillText(resolvedTitle, 0, 32);
    canvasContext.drawImage(imageElement, 0, 48);

    canvasElement.toBlob((canvasBlob) => {
      const formData = new FormData();

      chrome.storage.sync.get(
        ["gyazoAccessToken"],
        async ({ gyazoAccessToken }) => {
          if (!gyazoAccessToken) {
            return;
          }

          formData.append("access_token", gyazoAccessToken);
          formData.append("app", "Web Refinder");
          formData.append("imagedata", canvasBlob);
          formData.append("referer_url", url);

          formData.append(
            "desc",
            [resolvedTitle, url, description].filter((line) => line).join("\n")
          );

          const uploadResponse = await fetch(
            "https://upload.gyazo.com/api/upload",
            {
              method: "POST",
              body: formData,
              mimeType: "multipart/form-data",
            }
          );

          if (!uploadResponse.ok) {
            throw new Error(uploadResponse.statusText);
          }
        }
      );
    });
  };

  imageElement.src = thumbnailURL;
};

const getThumbnailURL = async ({ url }) => {
  try {
    const anyThumbnailResponse = await fetch(
      "https://af36atuifd.execute-api.us-east-1.amazonaws.com/default/any-thumbnail",
      {
        method: "POST",
        body: JSON.stringify({
          url,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!anyThumbnailResponse.ok) {
      throw new Error(anyThumbnailResponse.statusText);
    }

    const thumbnailURL = URL.createObjectURL(await anyThumbnailResponse.blob());

    // TODO: URL.revokeObjectURL(thumbnailURL);
    return thumbnailURL;
  } catch (exception) {
    console.error(exception);
  }

  // https://github.com/googlefonts/noto-emoji/blob/main/png/512/emoji_u1f4c4.png
  return "data:image/png;base64,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";
};
