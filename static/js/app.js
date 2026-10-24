/**
 * 网易云音乐工具箱 — 前端交互逻辑
 *
 * 依赖（由模板按顺序引入）：
 *   - jQuery 3.7.1
 *   - APlayer 1.10.1
 */
(function () {
  "use strict";

  $(function () {
    /* ==================== 歌词处理 ==================== */

    /**
     * 解析 LRC 歌词，返回按时间排序的 [时间戳, 原始行号, 文本] 列表。
     * @param {string} lyrics LRC 原文
     * @returns {Array<[number, number, string]>}
     */
    function lrctrim(lyrics) {
      const data = [];

      (lyrics || "").split("\n").forEach(function (line, index) {
        const matches = line.match(/\[(\d{2}):(\d{2}[\.:]?\d*)]/);
        if (!matches) {
          return;
        }

        const minutes = parseInt(matches[1], 10);
        const seconds = parseFloat(matches[2].replace(".", ":")) || 0;
        const timestamp = minutes * 60000 + seconds * 1000;

        let text = line.replace(/\[\d{2}:\d{2}[\.:]?\d*\]/g, "").trim();
        text = text.replace(/\s\s+/g, " ");

        data.push([timestamp, index, text]);
      });

      data.sort(function (a, b) {
        return a[0] - b[0];
      });

      return data;
    }

    /**
     * 合并原文歌词与翻译歌词，输出标准 LRC 文本。
     * @param {string} lyric 原文歌词
     * @param {string} tlyric 翻译歌词
     * @returns {string}
     */
    function lrctran(lyric, tlyric) {
      const original = lrctrim(lyric);
      const translation = lrctrim(tlyric);
      const len1 = original.length;
      const len2 = translation.length;
      let result = "";

      for (let i = 0, j = 0; i < len1 && j < len2; i++) {
        while (original[i][0] > translation[j][0] && j + 1 < len2) {
          j++;
        }

        if (original[i][0] === translation[j][0]) {
          translation[j][2] = translation[j][2].replace("/", "");
          if (translation[j][2]) {
            original[i][2] += ` (翻译：${translation[j][2]})`;
          }
          j++;
        }
      }

      for (let i = 0; i < len1; i++) {
        const t = original[i][0];
        result += `[${String(Math.floor(t / 60000)).padStart(2, "0")}:${String(
          Math.floor((t % 60000) / 1000),
        ).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}]${
          original[i][2]
        }\n`;
      }

      return result;
    }

    /* ==================== 链接 / ID 提取 ==================== */

    /** 提取文本中的第一个链接 */
    function extractLink(text) {
      const matches = text.match(/https?:\/\/\S+/g);
      return matches ? matches[0] : "";
    }

    /** 判断是否为网易云音乐链接 */
    function isValidNeteaseLink(link) {
      return (
        link.indexOf("http") !== -1 &&
        (link.indexOf("music.163.com") !== -1 ||
          link.indexOf("163cn.tv") !== -1)
      );
    }

    /** 提取网易云链接，否则回退到第一个数字 ID */
    function extractAndCheckId(text) {
      const link = extractLink(text);
      if (isValidNeteaseLink(link)) {
        return link;
      }

      const ids = text.match(/\b\d+\b/g);
      return ids && ids.length > 0 ? ids[0] : "";
    }

    /* ==================== 功能区切换 ==================== */

    const AREAS = {
      search: "#search-area",
      parse: "#parse-area",
      playlist: "#playlist-area",
      album: "#album-area",
    };

    // 切换模式时需要隐藏的结果区域（与原行为保持一致）
    const RESULTS_TO_HIDE = {
      search: ["#song-info", "#playlist-result", "#album-result"],
      parse: ["#search-result", "#playlist-result", "#album-result"],
      playlist: ["#search-result", "#song-info", "#album-result"],
      album: [
        "#search-result",
        "#song-info",
        "#playlist-result",
        "#album-result",
      ],
    };

    function switchMode(mode) {
      Object.keys(AREAS).forEach(function (name) {
        $(AREAS[name]).prop("hidden", name !== mode);
      });

      const hideResults = RESULTS_TO_HIDE[mode];
      if (hideResults) {
        $(hideResults.join(", ")).prop("hidden", true);
      }
    }

    $("#mode-select").on("change", function () {
      switchMode($(this).val());
    });

    /* ==================== 通用列表渲染 ==================== */

    /**
     * 生成歌曲列表项。
     * @param {Object} song 歌曲数据（id/name/artists/album/picUrl）
     * @param {Object} [options]
     * @param {number} [options.index] 序号（从 0 开始），传入后显示为 "1. 歌名"
     * @param {string} [options.coverClass] 封面尺寸样式类
     * @returns {string} 列表项 HTML
     */
    function buildTrackItem(song, options) {
      const opts = options || {};
      const index = opts.index;
      const coverClass = opts.coverClass || "track-cover";
      const title = index == null ? song.name : `${index + 1}. ${song.name}`;

      return `
        <li class="track-item">
          <div class="track-info">
            <img src="${song.picUrl}" alt="封面" class="${coverClass}">
            <div class="track-meta">
              <strong class="track-name">${title}</strong>
              <span class="track-artist">${song.artists}</span>
              <span class="track-album">[${song.album}]</span>
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-small select-song" data-id="${song.id}">解析</button>
        </li>`;
    }

    function scrollToForm() {
      $("html, body").animate(
        { scrollTop: $("#main-form").offset().top },
        300,
      );
    }

    /* ==================== 搜索 ==================== */

    $("#search-btn").on("click", function () {
      const keywords = $("#search_keywords").val();
      const limit = $("#search_limit").val();

      if (!keywords) {
        alert("请输入搜索关键词");
        return;
      }

      $.ajax({
        url: "/Search",
        method: "POST",
        data: { keyword: keywords, limit: limit },
        dataType: "json",
        success: function (data) {
          const $list = $("#search-list").empty();

          if (data.status === 200) {
            data.data.forEach(function (song) {
              $list.append(
                buildTrackItem(song, { coverClass: "search-cover" }),
              );
            });
          } else {
            $list.html('<li class="track-item">未找到相关歌曲</li>');
          }

          $("#search-result").prop("hidden", false);
        },
        error: function () {
          $("#search-list").html(
            '<li class="track-item">搜索失败，请重试</li>',
          );
          $("#search-result").prop("hidden", false);
        },
      });
    });

    /* ==================== 单曲解析 ==================== */

    // 搜索结果 / 歌单 / 专辑中的“解析”按钮
    $(document).on("click", ".select-song", function () {
      $("#song_ids").val($(this).data("id"));
      $("#mode-select").val("parse").trigger("change");
      scrollToForm();
    });

    $("#parse-btn").on("click", function () {
      const songIds = $("#song_ids").val();
      const level = $("#level").val();

      if (!songIds) {
        alert("请输入歌曲ID或URL");
        return;
      }

      $.post(
        "/Song_V1",
        { url: songIds, level: level, type: "json" },
        function (data) {
          if (data.status !== 200) {
            alert(data.data.msg);
            return;
          }

          $("#song_name").text(data.data.name);
          $("#artist_names").text(data.data.ar_name);
          $("#song_alname").text(data.data.al_name);
          $("#song_level").text(data.data.level);
          $("#song_size").text(data.data.size);

          let processedLyrics = data.data.lyric;
          if (data.data.tlyric) {
            processedLyrics = lrctran(data.data.lyric, data.data.tlyric);
          }
          $("#lyric").html(processedLyrics.replace(/\n/g, "<br>"));
          $("#song_url").attr("href", data.data.url).text("点击下载");
          $("#song-info").prop("hidden", false);
          $("#show-big-pic").data("pic", data.data.pic);

          new APlayer({
            container: document.getElementById("aplayer"),
            lrcType: 1,
            audio: [
              {
                name: data.data.name,
                artist: data.data.ar_name,
                url: data.data.url,
                cover: data.data.pic,
                lrc: processedLyrics,
              },
            ],
          });
        },
        "json",
      );
    });

    /* ==================== 大图预览 ==================== */

    const bigPicDialog = document.getElementById("bigPicDialog");

    $("#show-big-pic").on("click", function () {
      $("#big-pic-img").attr("src", $(this).data("pic"));
      bigPicDialog.showModal();
    });

    $("#big-pic-close").on("click", function () {
      bigPicDialog.close();
    });

    // 点击遮罩（dialog 本身）也可以关闭
    bigPicDialog.addEventListener("click", function (event) {
      if (event.target === bigPicDialog) {
        bigPicDialog.close();
      }
    });

    /* ==================== 歌单解析 ==================== */

    $("#playlist-btn").on("click", function () {
      let pid = $("#playlist_id").val().trim();

      if (!pid) {
        alert("请输入歌单ID或链接");
        return;
      }

      // 支持直接粘贴歌单链接
      const idMatch = pid.match(/playlist\?id=(\d+)/);
      if (idMatch) {
        pid = idMatch[1];
      }

      $.get(
        "/Playlist",
        { id: pid },
        function (data) {
          if (data.status === 200) {
            const pl = data.data.playlist;
            const $tracks = $("#playlist-tracks").empty();

            $("#playlist-cover").attr("src", pl.coverImgUrl);
            $("#playlist-name").text(pl.name);
            $("#playlist-creator").text("by " + pl.creator);
            $("#playlist-desc").text(pl.description || "");
            $("#playlist-count").text(pl.trackCount);

            pl.tracks.forEach(function (song, idx) {
              $tracks.append(buildTrackItem(song, { index: idx }));
            });
          } else {
            $("#playlist-tracks").html(
              '<li class="track-item">歌单解析失败：' +
                data.data.msg +
                "</li>",
            );
          }

          $("#playlist-result").prop("hidden", false);
        },
        "json",
      );
    });

    /* ==================== 专辑解析 ==================== */

    $(document).on("click", "#album-btn", function () {
      let aid = $("#album_id").val().trim();

      if (!aid) {
        alert("请输入专辑ID或链接");
        return;
      }

      // 支持直接粘贴专辑链接
      const idMatch = aid.match(/album\?id=(\d+)/);
      if (idMatch) {
        aid = idMatch[1];
      }

      $.get(
        "/Album",
        { id: aid },
        function (data) {
          if (data.status === 200) {
            const al = data.data.album;
            const $tracks = $("#album-tracks").empty();

            $("#album-cover").attr("src", al.coverImgUrl);
            $("#album-name").text(al.name);
            $("#album-artist").text(al.artist);
            $("#album-desc").text(al.description || "");
            $("#album-count").text(al.songs.length);

            al.songs.forEach(function (song, idx) {
              $tracks.append(buildTrackItem(song, { index: idx }));
            });
          } else {
            $("#album-tracks").html(
              '<li class="track-item">专辑解析失败：' +
                data.data.msg +
                "</li>",
            );
          }

          $("#album-result").prop("hidden", false);
        },
        "json",
      );
    });

  });
})();
