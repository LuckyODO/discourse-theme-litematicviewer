# frozen_string_literal: true

require "base64"

RSpec.describe "Litematic attachment previews" do
  fab!(:schematic) do
    Fabricate(
      :upload,
      original_filename: "starter-house.litematic",
      extension: "litematic",
      width: nil,
      height: nil,
    )
  end
  fab!(:document) do
    Fabricate(:upload, original_filename: "instructions.pdf", extension: "pdf", width: nil, height: nil)
  end
  fab!(:post) do
    Fabricate(
      :post,
      raw: <<~MD,
        #{UploadMarkdown.new(schematic).to_markdown}

        #{UploadMarkdown.new(document).to_markdown}

        [An external schematic](https://example.com/external.litematic)
      MD
    )
  end

  let(:viewer_requests) { [] }
  let(:download_requests) { [] }
  let(:download_status) { 200 }

  # A gzip-compressed, single-region Litematic v6 containing one stone block.
  # The viewer is mocked: these tests cover Discourse integration and file
  # handoff, while renderer compatibility is verified separately.
  let(:schematic_bytes) do
    Base64.strict_decode64(
      "H4sIAAAAAAAACn2QTWrDQAyFnxmTOOOGEugBco7u+rd0G+qQveKqyVBbAo8MbW7QWxfHzs+q2gie9D2e5AGH6YbbGFQATBx82W0vQuJwVwThqqVPeyaj82j+65EVbPRBRhnSV2oYszfhZTQVzjB56GyvLfL1nhteGkeLDvk774LKk3Zig3++VqP6sdbqK14rG627hnvFY/4iVa0xyK4MB3ZIvofN5Gfsh74DHtPBP3qkBQXxyFYagwWVkcJIYaR6KP3XdYbFMV1pZLyims3Y95PT1bfN6UP3x9txg/xCxCHauf4ASToYp3QBAAA=",
    )
  end

  let(:viewer_html) do
    <<~HTML
      <!doctype html>
      <html lang="en">
        <title>Test schematic viewer</title>
        <body>
          <p id="loaded-file"></p>
          <script>
            const params = new URLSearchParams(location.search);
            const origin = params.get("parentOrigin");
            const channel = params.get("channel");
            const protocol = "litematic-preview-v1";
            const send = (type) => parent.postMessage({ protocol, channel, type }, origin);
            addEventListener("message", (event) => {
              if (event.source !== parent || event.origin !== origin ||
                  event.data?.protocol !== protocol || event.data.channel !== channel) {
                return;
              }
              if (event.data.type === "load") {
                document.getElementById("loaded-file").textContent = event.data.file.name;
                send("loaded");
              }
            });
            send("ready");
          </script>
        </body>
      </html>
    HTML
  end

  before do
    @theme = upload_theme_or_component
    @theme.settings[:viewer_url].value = "https://litematic-viewer.test/index.html"

    page.driver.with_playwright_page do |browser_page|
      browser_page.route(
        "https://litematic-viewer.test/**",
        lambda do |route, request|
          viewer_requests << request.url
          route.fulfill(status: 200, contentType: "text/html", body: viewer_html)
        end,
      )
      browser_page.route(
        %r{/uploads/short-url/[^/?]+\.litematic(?:\?|$)},
        lambda do |route, request|
          download_requests << request.url
          route.fulfill(
            status: download_status,
            contentType: "application/octet-stream",
            body: schematic_bytes,
          )
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
    expect(page).to have_link("An external schematic", href: "https://example.com/external.litematic")
    expect(page).to have_no_css(".litematic-preview-modal")
    expect(viewer_requests).to be_empty
    expect(download_requests).to be_empty
  end

  it "opens an accessible preview, passes the attachment, and releases the frame on close" do
    visit post.topic.url
    find(".litematic-attachment__preview").click

    expect(page).to have_css(".litematic-preview-modal[role='dialog']")
    expect(page).to have_css(
      ".litematic-preview-modal .d-modal__title-text",
      text: schematic.original_filename,
    )
    expect(page).to have_css(".litematic-preview[aria-busy='false']")
    expect(page).to have_css(".litematic-preview__stage iframe", count: 1)
    within ".litematic-preview-modal" do
      expect(page).to have_link("Download", href: /#{Regexp.escape(schematic.short_path)}\z/)
    end
    within_frame(find(".litematic-preview__stage iframe")) do
      expect(page).to have_css("#loaded-file", text: schematic.original_filename)
    end
    expect(viewer_requests.size).to eq(1)
    expect(download_requests.size).to eq(1)

    find(".litematic-preview-modal .modal-close").click

    expect(page).to have_no_css(".litematic-preview-modal")
    expect(page).to have_no_css(".litematic-viewer-frame", visible: :all)
    expect(
      page.evaluate_script(
        "document.activeElement.classList.contains('litematic-attachment__preview')",
      ),
    ).to eq(true)

    find(".litematic-attachment__preview").click
    expect(page).to have_css(".litematic-preview[aria-busy='false']")
    expect(page).to have_css(".litematic-preview__stage iframe", count: 1)
    find(".litematic-preview-modal .modal-close").click
    expect(page).to have_no_css(".litematic-viewer-frame", visible: :all)
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
        expect(page).to have_no_css("iframe", visible: :all)
      end
    end
  end

  context "when the component is disabled" do
    before { @theme.settings[:enabled].value = false }

    it "leaves the original attachment download links intact" do
      visit post.topic.url

      expect(page).to have_link(schematic.original_filename, href: schematic.short_path)
      expect(page).to have_no_css(".litematic-attachment")
      expect(viewer_requests).to be_empty
      expect(download_requests).to be_empty
    end
  end
end
