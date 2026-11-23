# frozen_string_literal: true

require "base64"
require "tempfile"

RSpec.describe "Litematic attachment previews" do
  let(:schematic) do
    Tempfile.create(%w[starter-house .litematic]) do |file|
      file.binmode
      file.write(schematic_bytes)
      file.flush
      file.rewind
      upload = UploadCreator.new(file, "starter-house.litematic").create_for(Fabricate(:user).id)
      raise upload.errors.full_messages.join(", ") unless upload.persisted?

      upload
    end
  end
  let(:document) do
    Fabricate(
      :upload,
      original_filename: "instructions.pdf",
      extension: "pdf",
      width: nil,
      height: nil,
    )
  end
  let(:post) { Fabricate(:post, raw: <<~MD) }
        #{UploadMarkdown.new(schematic).to_markdown}

        #{UploadMarkdown.new(document).to_markdown}

        [An external schematic](https://example.com/external.litematic)
      MD

  let(:asset_requests) { [] }
  let(:external_requests) { [] }
  let(:download_requests) { [] }
  let(:download_status) { 200 }

  # A gzip-compressed Litematic v6 with one stone block. Discourse stores and
  # serves the file; the bundled parser worker and WebGL renderer run normally.
  let(:schematic_bytes) do
    Base64.strict_decode64(
      "H4sIAAAAAAAACn2QTWrDQAyFnxmTOOOGEugBco7u+rd0G+qQveKqyVBbAo8MbW7QWxfHzs+q2gie9D2e5AGH6YbbGFQATBx82W0vQuJwVwThqqVPeyaj82j+65EVbPRBRhnSV2oYszfhZTQVzjB56GyvLfL1nhteGkeLDvk774LKk3Zig3++VqP6sdbqK14rG627hnvFY/4iVa0xyK4MB3ZIvofN5Gfsh74DHtPBP3qkBQXxyFYagwWVkcJIYaR6KP3XdYbFMV1pZLyims3Y95PT1bfN6UP3x9txg/xCxCHauf4ASToYp3QBAAA=",
    )
  end

  # Probe the browser before loading the renderer. A renderer failure must never
  # choose the fallback branch; real rendering remains mandatory when supported.
  def webgl_available?
    page.evaluate_script(<<~JS)
      (() => {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2", {
          antialias: true, alpha: false, powerPreference: "low-power",
        });
        const available = Boolean(gl);
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
        return available;
      })()
    JS
  end

  def expect_preview_result(graphics_available)
    if graphics_available
      expect(page).to have_css(".litematic-model-summary", text: /1.*1 × 1 × 1/, wait: 20)
      expect(page).to have_no_css(".litematic-preview__status")
      expect(page).to have_css(".litematic-preview__stage canvas", count: 1)
      expect(page).to have_css(".litematic-layer")
      expect(page).to have_button("Reset view")
      expect(find(".litematic-model-summary")["data-block-count"]).to eq("1")
    else
      expect(page).to have_css(
        ".litematic-preview-modal [role='alert']",
        text: "3D graphics are unavailable in this browser.",
      )
      expect(page).to have_button("Try again")
      expect(page).to have_no_css(".litematic-preview__stage canvas", visible: :all)
      expect(page).to have_no_css(".litematic-model-summary")
    end
    within ".litematic-preview-modal" do
      expect(page).to have_link("Download", href: /#{Regexp.escape(schematic.short_path)}\z/)
    end
  end

  before do
    SiteSetting.content_security_policy = true
    SiteSetting.authorized_extensions = "#{SiteSetting.authorized_extensions}|litematic|pdf"
    @theme = upload_theme_or_component
    @asset_paths =
      %w[litematic_renderer litematic_worker].map do |name|
        URI(@theme.theme_fields.find_by!(name: name).javascript_cache.local_url).path
      end

    page.driver.with_playwright_page do |browser_page|
      browser_page.on(
        "request",
        lambda do |request|
          uri = URI(request.url)
          asset_requests << uri.path if @asset_paths.include?(uri.path)
          if %w[http https].include?(uri.scheme) &&
               ![Capybara.server_host, "localhost", "test.localhost"].include?(uri.host)
            external_requests << request.url
          end
        end,
      )
      browser_page.route(
        %r{/uploads/short-url/[^/?]+\.litematic(?:\?|$)},
        lambda do |route, request|
          download_requests << request.url
          if download_status == 200
            route.continue
          else
            route.fulfill(status: download_status, contentType: "text/plain", body: "Forbidden")
          end
        end,
      )
    end
  end

  it "enhances uploaded schematics without loading files or a viewer during topic browsing" do
    visit post.topic.url

    expect(page).to have_css(".litematic-attachment", count: 1)
    within ".litematic-attachment" do
      expect(page).to have_css(".litematic-attachment__name", text: schematic.original_filename)
      expect(page).to have_button("3D preview")
      expect(page).to have_link("Download", href: schematic.short_path)
    end
    expect(page).to have_link(document.original_filename, href: document.short_path)
    expect(page).to have_link(
      "An external schematic",
      href: "https://example.com/external.litematic",
    )
    expect(page).to have_no_css(".litematic-preview-modal")
    expect(asset_requests).to be_empty
    expect(download_requests).to be_empty
  end

  context "when several uploaded schematics share one paragraph" do
    let(:display_names) do
      [
        "a.litematic",
        "单片打包合成器版本.litematic",
        "a_very_long_schematic_filename_#{"without_any_breaks_" * 12}.litematic",
        "collection.litematic",
      ]
    end
    let(:post) do
      links =
        display_names.map { |name| UploadMarkdown.new(schematic).to_markdown(display_name: name) }
      Fabricate(:post, raw: "Schematics for testing:\n#{links.join("\n")}")
    end

    [false, true].each do |mobile|
      it "keeps attachment rows aligned and contained on #{mobile ? "mobile" : "desktop"}",
         mobile: mobile do
        cooked = Nokogiri::HTML5.fragment(post.cooked)
        expect(cooked.at_css("p").css("a.attachment").size).to eq(4)
        expect(cooked.at_css("p").css("br").size).to be >= 3
        visit post.topic.url

        expect(page).to have_css(".litematic-attachment", count: display_names.size)
        expect(page).to have_content("Schematics for testing:")
        all(".litematic-attachment").each_with_index do |row, index|
          within row do
            expect(page).to have_css(".litematic-attachment__name", text: display_names[index])
            expect(page).to have_content(schematic.human_filesize)
            expect(page).to have_button("3D preview")
            expect(page).to have_link("Download", href: schematic.short_path)
            expect(page).to have_css("a.attachment.litematic-attachment__download", count: 1)
          end
        end

        layout = page.evaluate_script(<<~JS)
          (() => {
            const rows = Array.from(document.querySelectorAll(".litematic-attachment"));
            const first = rows[0].getBoundingClientRect();
            return rows.map((row) => {
              const box = row.getBoundingClientRect();
              const cookedBox = row.closest(".cooked").getBoundingClientRect();
              const preview = row.querySelector(".litematic-attachment__preview").getBoundingClientRect();
              const anchor = row.querySelector("a.attachment");
              const download = anchor.getBoundingClientRect();
              const name = row.querySelector(".litematic-attachment__name").getBoundingClientRect();
              return {
                aligned: Math.abs(box.left - first.left) < 1 && Math.abs(box.width - first.width) < 1,
                buttonsTogether: Math.abs(preview.top - download.top) < 1 && preview.right <= download.left + 1,
                contained: box.left >= cookedBox.left - 1 && box.right <= cookedBox.right + 1 &&
                  row.scrollWidth <= row.clientWidth + 1 && preview.left >= box.left && download.right <= box.right,
                nameBesideActions: name.top < preview.bottom && name.bottom > preview.top,
                box: { left: box.left, width: box.width, height: box.height },
              };
            });
          })()
        JS
        layout.each do |row|
          expect(row).to include("aligned" => true, "buttonsTogether" => true, "contained" => true)
          expect(row["nameBesideActions"]).to eq(true) unless mobile
        end
        expect(asset_requests).to be_empty
        expect(download_requests).to be_empty
      end
    end
  end

  it "parses the stored attachment with the same-origin bundled worker under forum CSP" do
    visit post.topic.url
    expect(page).to have_button("3D preview")

    result = nil
    page.driver.with_playwright_page do |browser_page|
      result =
        browser_page.evaluate(
          <<~JS,
          async ({ workerUrl, uploadUrl }) => {
            if (new URL(workerUrl, location.href).origin !== location.origin) {
              throw new Error("Worker must come from the forum origin");
            }
            const response = await fetch(uploadUrl, {
              credentials: "same-origin",
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) throw new Error("Stored attachment could not be fetched");
            const buffer = await response.arrayBuffer();
            const worker = new Worker(workerUrl);
            let timeout;
            try {
              return await new Promise((resolve, reject) => {
                timeout = setTimeout(() => reject(new Error("Worker timed out")), 10000);
                worker.onerror = (event) => reject(new Error(event.message || "Worker failed"));
                worker.onmessageerror = () => reject(new Error("Worker message failed"));
                worker.onmessage = ({ data }) => {
                  if (data.type === "error") reject(new Error(data.message));
                  if (data.type === "mesh") resolve({
                    blockCount: data.blockCount,
                    bounds: data.bounds,
                    faceCount: data.faceCount,
                    positionCount: data.positions.length,
                    uvCount: data.uvs.length,
                    opaqueFaceCount: data.opaqueFaceCount,
                    translucentFaceCount: data.translucentFaceCount,
                    validUVs: data.uvs.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
                    texturedUVs: data.uvs.some((value) => value !== data.uvs[0]),
                    materials: data.materials,
                  });
                };
                worker.postMessage({ type: "load", id: 1, buffer }, [buffer]);
              });
            } finally {
              clearTimeout(timeout);
              worker.terminate();
            }
          }
        JS
          arg: {
            workerUrl: @asset_paths.last,
            uploadUrl: schematic.short_path,
          },
        )
    end

    expect(result).to eq(
      "blockCount" => 1,
      "bounds" => {
        "min" => [0, 0, 0],
        "max" => [1, 1, 1],
      },
      "faceCount" => 6,
      "positionCount" => 108,
      "uvCount" => 72,
      "opaqueFaceCount" => 6,
      "translucentFaceCount" => 0,
      "validUVs" => true,
      "texturedUVs" => true,
      "materials" => [{ "name" => "minecraft:stone", "count" => 1 }],
    )
    expect(asset_requests.uniq).to eq([@asset_paths.last])
    expect(download_requests.size).to eq(1)
    expect(external_requests).to be_empty
    expect(page).to have_no_css(".litematic-preview-modal")
  end

  it "opens the native preview, handles browser graphics support, and releases it on close" do
    visit post.topic.url
    graphics_available = webgl_available?
    find(".litematic-attachment__preview").click

    expect(page).to have_css(".litematic-preview-modal[role='dialog']")
    expect(page).to have_css(
      ".litematic-preview-modal .d-modal__title-text",
      text: schematic.original_filename,
    )
    expect_preview_result(graphics_available)
    expected_assets = graphics_available ? @asset_paths : [@asset_paths.first]
    expect(asset_requests.uniq).to match_array(expected_assets)
    expect(external_requests).to be_empty
    expect(download_requests.size).to eq(1)
    if graphics_available
      material_toggle = find(".litematic-materials__toggle")
      expect(material_toggle["aria-expanded"]).to eq("false")
      material_toggle.click
      expect(material_toggle["aria-expanded"]).to eq("true")
      within ".litematic-materials__panel" do
        expect(page).to have_content("Entire schematic")
        expect(page).to have_css("li", text: "stone1", count: 1)
      end
      expect(page.evaluate_script(<<~JS)).to eq(true)
        (() => {
          const list = document.querySelector(".litematic-materials__list");
          const row = list.querySelector("li");
          const bounds = list.getBoundingClientRect();
          const rowBounds = row.getBoundingClientRect();
          return bounds.width > 200 && rowBounds.top >= bounds.top && rowBounds.bottom <= bounds.bottom;
        })()
      JS
      material_toggle.send_keys(:escape)
      expect(page).to have_no_css(".litematic-materials__panel")
      expect(page).to have_css(".litematic-preview-modal[role='dialog']")
      expect(material_toggle["aria-expanded"]).to eq("false")
      find(".litematic-reset").click
      expect(page).to have_css(".litematic-preview__stage canvas", count: 1)
    end

    find(".litematic-preview-modal .modal-close").click

    expect(page).to have_no_css(".litematic-preview-modal")
    expect(page).to have_no_css(".litematic-preview__stage canvas", visible: :all)
    expect(
      page.evaluate_script(
        "document.activeElement.classList.contains('litematic-attachment__preview')",
      ),
    ).to eq(true)

    find(".litematic-attachment__preview").click
    expect(page).to have_css(".litematic-preview-modal[role='dialog']")
    expect_preview_result(graphics_available)
    expect(download_requests.size).to eq(2)
    expect(external_requests).to be_empty
    find(".litematic-preview-modal .modal-close").click
    expect(page).to have_no_css(".litematic-preview-modal")
    expect(page).to have_no_css(".litematic-preview__stage canvas", visible: :all)
  end

  context "when an attachment cannot be downloaded" do
    let(:download_status) { 403 }

    it "keeps the download action and displays a recoverable error" do
      visit post.topic.url
      find(".litematic-attachment__preview").click

      within ".litematic-preview-modal" do
        expect(page).to have_css("[role='alert']", text: "The attachment could not be read")
        expect(page).to have_button("Try again")
        expect(page).to have_link("Download", href: /#{Regexp.escape(schematic.short_path)}\z/)
        expect(page).to have_no_css("canvas", visible: :all)
      end
    end
  end

  context "when the component is disabled" do
    before { @theme.settings[:enabled].value = false }

    it "leaves the original attachment download links intact" do
      visit post.topic.url

      expect(page).to have_link(schematic.original_filename, href: schematic.short_path)
      expect(page).to have_no_css(".litematic-attachment")
      expect(asset_requests).to be_empty
      expect(download_requests).to be_empty
    end
  end
end
